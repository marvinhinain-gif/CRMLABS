import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import Papa from "papaparse";
import { db, type DbOrTx } from "../db";
import {
  appointments,
  channelIdentities,
  connectedAccounts,
  contacts,
  contactTags,
  conversations,
  messages,
  notes,
  opportunities,
  pipelineStages,
  relationshipEntries,
  socialComments,
  stageHistory,
  tags,
  tasks,
  users,
} from "../db/schema";
import type { Ctx } from "../context";
import { assertCan, can, contactScope } from "../permissions";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, cleanText, normalizeHandle, NOVO_INTERESSADO_KEY } from "./common";
import { activeEntryFor, addToBoard } from "./board";
import { assertMember } from "./team";
import { periodRange, tsz } from "../time";

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullish()
    .transform((v) => cleanText(v, max));

export const contactInputSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  username: optionalText(60),
  profileUrl: optionalText(300).refine((v) => !v || /^https?:\/\//i.test(v), "Use um link começando com http(s)://"),
  email: optionalText(200).refine((v) => !v || z.string().email().safeParse(v).success, "E-mail inválido."),
  phone: optionalText(40),
  summary: optionalText(140),
  nextAction: optionalText(140),
  nextActionAt: z.coerce.date().nullish(),
  ownerId: z.string().uuid().nullish(),
});

export const createContactSchema = contactInputSchema.extend({
  stageId: z.string().uuid().nullish(),
  tagNames: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  force: z.boolean().optional(),
});

export const listContactsSchema = z.object({
  q: z.string().trim().max(100).optional(),
  ownerId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  source: z.enum(["manual", "instagram_dm", "instagram_comment", "import"]).optional(),
  stageId: z.string().uuid().optional(),
  /** Contatos cuja primeira entrada em "Novo interessado" ocorreu no período (mesma regra do dashboard). */
  novosInteressados: z.enum(["today", "7d", "30d", "month", "last_month"]).optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});

function visibleContacts(ctx: Ctx): SQL {
  return and(contactScope(ctx), isNull(contacts.archivedAt), isNull(contacts.mergedIntoId))!;
}

export async function getVisibleContact(ctx: Ctx, id: string, tx: DbOrTx = db) {
  const [c] = await tx.select().from(contacts).where(and(eq(contacts.id, id), contactScope(ctx)));
  if (!c) throw notFound("Contato não encontrado.");
  return c;
}

function resolveOwner(ctx: Ctx, requested: string | null | undefined, current?: string | null) {
  if (requested === undefined) return current === undefined ? (can(ctx, "contacts.assign") ? null : ctx.userId) : current;
  if (!can(ctx, "contacts.assign") && requested !== ctx.userId) {
    throw forbidden("Somente administradores e gestores podem atribuir contatos a outras pessoas.");
  }
  return requested;
}

export async function listContacts(ctx: Ctx, f: z.infer<typeof listContactsSchema>) {
  const conds: SQL[] = [visibleContacts(ctx)];
  if (f.q) {
    const term = `%${f.q.replace(/^@/, "").replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(contacts.name, term), ilike(contacts.username, term), ilike(contacts.email, term), ilike(contacts.phone, term))!);
  }
  if (f.ownerId) conds.push(eq(contacts.ownerId, f.ownerId));
  if (f.source) conds.push(eq(contacts.source, f.source));
  if (f.tagId) conds.push(sql`exists (select 1 from ${contactTags} ct where ct.contact_id = ${contacts.id} and ct.tag_id = ${f.tagId})`);
  if (f.stageId) {
    conds.push(
      sql`exists (select 1 from ${relationshipEntries} re where re.contact_id = ${contacts.id} and re.stage_id = ${f.stageId} and re.closed_at is null)`,
    );
  }
  if (f.novosInteressados) {
    const { start, end } = periodRange(f.novosInteressados, ctx.org.timezone);
    conds.push(sql`(select min(sh.created_at) from ${stageHistory} sh join ${pipelineStages} ps on ps.id = sh.to_stage_id
      where sh.contact_id = ${contacts.id} and sh.entity_type = 'relationship' and ps.key = ${NOVO_INTERESSADO_KEY}) between ${tsz(start)} and ${tsz(new Date(end.getTime() - 1))}`);
  }
  const where = and(...conds);
  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: contacts.id,
        name: contacts.name,
        username: contacts.username,
        email: contacts.email,
        phone: contacts.phone,
        source: contacts.source,
        ownerId: contacts.ownerId,
        ownerName: users.name,
        avatarUrl: contacts.avatarUrl,
        createdAt: contacts.createdAt,
        lastInteractionAt: contacts.lastInteractionAt,
        stageName: sql<string | null>`(select ps.name from ${relationshipEntries} re join ${pipelineStages} ps on ps.id = re.stage_id where re.contact_id = ${contacts.id} and re.closed_at is null limit 1)`,
        stageColor: sql<string | null>`(select ps.color from ${relationshipEntries} re join ${pipelineStages} ps on ps.id = re.stage_id where re.contact_id = ${contacts.id} and re.closed_at is null limit 1)`,
        hasOfficialIdentity: sql<boolean>`exists (select 1 from ${channelIdentities} ci where ci.contact_id = ${contacts.id})`,
      })
      .from(contacts)
      .leftJoin(users, eq(users.id, contacts.ownerId))
      .where(where)
      .orderBy(desc(sql`coalesce(${contacts.lastInteractionAt}, ${contacts.createdAt})`))
      .limit(f.pageSize)
      .offset((f.page - 1) * f.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(contacts).where(where),
  ]);
  return { rows, total, page: f.page, pageSize: f.pageSize };
}

export async function getContactDetail(ctx: Ctx, id: string) {
  const c = await getVisibleContact(ctx, id);
  const [owner] = c.ownerId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, c.ownerId)) : [];
  const [identities, entry, contactTagRows, conv, opps, openTasks, noteRows, history] = await Promise.all([
    db
      .select({ id: channelIdentities.id, provider: channelIdentities.provider, username: channelIdentities.username, accountUsername: connectedAccounts.username, accountStatus: connectedAccounts.status })
      .from(channelIdentities)
      .innerJoin(connectedAccounts, eq(connectedAccounts.id, channelIdentities.accountId))
      .where(eq(channelIdentities.contactId, c.id)),
    activeEntryFor(c.id, ctx.orgId),
    db.select({ id: tags.id, name: tags.name, color: tags.color }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, c.id)),
    db.select({ id: conversations.id, unreadCount: conversations.unreadCount, lastMessageAt: conversations.lastMessageAt, lastMessagePreview: conversations.lastMessagePreview, lastMessageDirection: conversations.lastMessageDirection }).from(conversations).where(eq(conversations.contactId, c.id)).limit(1),
    db
      .select({ id: opportunities.id, title: opportunities.title, status: opportunities.status, valueCents: opportunities.valueCents, stageName: pipelineStages.name, closerName: users.name })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(users, eq(users.id, opportunities.closerId))
      .where(eq(opportunities.contactId, c.id))
      .orderBy(desc(opportunities.createdAt)),
    db
      .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, status: tasks.status, ownerName: users.name })
      .from(tasks)
      .leftJoin(users, eq(users.id, tasks.ownerId))
      .where(and(eq(tasks.contactId, c.id), eq(tasks.orgId, ctx.orgId)))
      .orderBy(asc(tasks.status), asc(tasks.dueAt))
      .limit(20),
    db
      .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, authorName: users.name })
      .from(notes)
      .leftJoin(users, eq(users.id, notes.authorId))
      .where(eq(notes.contactId, c.id))
      .orderBy(desc(notes.createdAt))
      .limit(50),
    db
      .select({ id: stageHistory.id, entityType: stageHistory.entityType, fromStageName: stageHistory.fromStageName, toStageName: stageHistory.toStageName, reason: stageHistory.reason, createdAt: stageHistory.createdAt, actorName: users.name })
      .from(stageHistory)
      .leftJoin(users, eq(users.id, stageHistory.actorId))
      .where(and(eq(stageHistory.contactId, c.id), eq(stageHistory.orgId, ctx.orgId)))
      .orderBy(desc(stageHistory.createdAt))
      .limit(50),
  ]);
  return {
    contact: { ...c, owner: owner ?? null },
    identities,
    entry,
    tags: contactTagRows,
    conversation: conv[0] ?? null,
    opportunities: opps,
    tasks: openTasks,
    notes: noteRows,
    history,
  };
}

async function findDuplicates(orgId: string, input: { username?: string | null; email?: string | null; phone?: string | null }, excludeId?: string) {
  const ors: SQL[] = [];
  if (input.username) ors.push(sql`lower(${contacts.username}) = ${input.username.toLowerCase()}`);
  if (input.email) ors.push(sql`lower(${contacts.email}) = ${input.email.toLowerCase()}`);
  if (input.phone) ors.push(eq(contacts.phone, input.phone));
  if (!ors.length) return [];
  return db
    .select({ id: contacts.id, name: contacts.name, username: contacts.username, email: contacts.email, ownerId: contacts.ownerId })
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), isNull(contacts.mergedIntoId), isNull(contacts.archivedAt), or(...ors), excludeId ? ne(contacts.id, excludeId) : undefined))
    .limit(5);
}

export async function createContact(ctx: Ctx, raw: z.input<typeof createContactSchema>) {
  const input = createContactSchema.parse(raw);
  const ownerId = resolveOwner(ctx, input.ownerId);
  if (ownerId) await assertMember(ctx.orgId, ownerId, { activeOnly: true });
  const username = normalizeHandle(input.username);
  if (!input.force) {
    const dups = await findDuplicates(ctx.orgId, { username, email: input.email, phone: input.phone });
    if (dups.length) {
      const visible = can(ctx, "data.all") ? dups : dups.filter((d) => d.ownerId === ctx.userId);
      throw new AppError("conflict", "Já existe um contato com o mesmo @, e-mail ou telefone.", {
        duplicates: visible.map(({ ownerId: _o, ...d }) => d),
        hiddenDuplicates: dups.length - visible.length,
      });
    }
  }
  const contact = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(contacts)
      .values({
        orgId: ctx.orgId,
        name: input.name,
        username,
        profileUrl: input.profileUrl ?? (username ? `https://www.instagram.com/${username}/` : null),
        email: input.email,
        phone: input.phone,
        summary: input.summary,
        nextAction: input.nextAction,
        nextActionAt: input.nextActionAt ?? null,
        ownerId,
        source: "manual",
      })
      .returning();
    if (input.stageId) await addToBoard(ctx, c.id, input.stageId, tx);
    if (input.tagNames?.length) await applyTags(tx, ctx.orgId, c.id, input.tagNames);
    await audit(tx, ctx, "contact.created", "contact", c.id);
    return c;
  });
  await publish({ orgId: ctx.orgId, topic: "contacts", entityId: contact.id, ownerIds: [contact.ownerId] });
  if (input.stageId) await publish({ orgId: ctx.orgId, topic: "board", entityId: contact.id, ownerIds: [contact.ownerId] });
  return contact;
}

export const updateContactSchema = contactInputSchema.partial();

export async function updateContact(ctx: Ctx, id: string, raw: z.input<typeof updateContactSchema>) {
  const input = updateContactSchema.parse(raw);
  const c = await getVisibleContact(ctx, id);
  const patch: Partial<typeof contacts.$inferInsert> = { updatedAt: new Date() };
  for (const k of ["name", "profileUrl", "email", "phone", "summary", "nextAction"] as const) {
    if (input[k] !== undefined) patch[k] = input[k] as never;
  }
  if (input.username !== undefined) patch.username = normalizeHandle(input.username);
  if (input.nextActionAt !== undefined) patch.nextActionAt = input.nextActionAt ?? null;
  if (input.ownerId !== undefined && input.ownerId !== c.ownerId) {
    patch.ownerId = resolveOwner(ctx, input.ownerId, c.ownerId);
    if (patch.ownerId) await assertMember(ctx.orgId, patch.ownerId, { activeOnly: true });
  }
  const [updated] = await db.update(contacts).set(patch).where(eq(contacts.id, c.id)).returning();
  if (patch.ownerId !== undefined) {
    // A conversa acompanha o novo responsável quando ainda era do anterior ou estava sem dono.
    await db
      .update(conversations)
      .set({ ownerId: patch.ownerId })
      .where(and(eq(conversations.contactId, c.id), or(isNull(conversations.ownerId), c.ownerId ? eq(conversations.ownerId, c.ownerId) : undefined)));
    await audit(db, ctx, "contact.assigned", "contact", c.id, { from: c.ownerId, to: patch.ownerId });
  }
  await publish({ orgId: ctx.orgId, topic: "contacts", entityId: c.id, ownerIds: [c.ownerId, updated.ownerId] });
  await publish({ orgId: ctx.orgId, topic: "board", entityId: c.id, ownerIds: [c.ownerId, updated.ownerId] });
  return updated;
}

export async function archiveContact(ctx: Ctx, id: string) {
  assertCan(ctx, "contacts.assign", "Somente administradores e gestores podem arquivar contatos.");
  const c = await getVisibleContact(ctx, id);
  await db.transaction(async (tx) => {
    await tx.update(contacts).set({ archivedAt: new Date() }).where(eq(contacts.id, c.id));
    await tx.update(relationshipEntries).set({ closedAt: new Date() }).where(and(eq(relationshipEntries.contactId, c.id), isNull(relationshipEntries.closedAt)));
    await audit(tx, ctx, "contact.archived", "contact", c.id);
  });
  await publish({ orgId: ctx.orgId, topic: "board" });
  await publish({ orgId: ctx.orgId, topic: "contacts" });
}

// ---------- Tags ----------
async function applyTags(tx: DbOrTx, orgId: string, contactId: string, names: string[]) {
  const unique = [...new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).values()].filter(Boolean);
  await tx.delete(contactTags).where(eq(contactTags.contactId, contactId));
  if (!unique.length) return;
  await tx.insert(tags).values(unique.map((name) => ({ orgId, name }))).onConflictDoNothing();
  const rows = await tx
    .select()
    .from(tags)
    .where(and(eq(tags.orgId, orgId), inArray(sql`lower(${tags.name})`, unique.map((n) => n.toLowerCase()))));
  await tx.insert(contactTags).values(rows.map((t) => ({ contactId, tagId: t.id }))).onConflictDoNothing();
}

export async function setContactTags(ctx: Ctx, id: string, names: string[]) {
  const c = await getVisibleContact(ctx, id);
  await db.transaction((tx) => applyTags(tx, ctx.orgId, c.id, names));
  await publish({ orgId: ctx.orgId, topic: "board", entityId: c.id, ownerIds: [c.ownerId] });
}

export async function listTags(ctx: Ctx) {
  return db.select({ id: tags.id, name: tags.name, color: tags.color }).from(tags).where(eq(tags.orgId, ctx.orgId)).orderBy(asc(tags.name));
}

// ---------- Notas internas ----------
export async function addNote(ctx: Ctx, contactId: string, body: string) {
  const c = await getVisibleContact(ctx, contactId);
  const text = cleanText(body, 5000);
  if (!text) throw invalid("Escreva a nota.");
  const [n] = await db.insert(notes).values({ orgId: ctx.orgId, contactId: c.id, authorId: ctx.userId, body: text }).returning();
  await publish({ orgId: ctx.orgId, topic: "contacts", entityId: c.id, ownerIds: [c.ownerId] });
  return n;
}

// ---------- Importação CSV ----------
const CSV_FIELDS = {
  nome: "name",
  name: "name",
  "@": "username",
  usuario: "username",
  usuário: "username",
  instagram: "username",
  username: "username",
  email: "email",
  "e-mail": "email",
  telefone: "phone",
  phone: "phone",
  whatsapp: "phone",
  perfil: "profileUrl",
  link: "profileUrl",
  resumo: "summary",
  tags: "tags",
} as const;

export type ImportRow = {
  line: number;
  data: { name: string; username: string | null; email: string | null; phone: string | null; profileUrl: string | null; summary: string | null; tags: string[] };
  errors: string[];
  duplicateOf: { id: string; name: string } | null;
  duplicateInFile: number | null;
};

export async function previewImport(ctx: Ctx, csv: string) {
  assertCan(ctx, "contacts.import");
  if (csv.length > 2_000_000) throw invalid("Arquivo grande demais (máximo 2 MB).");
  const parsed = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase() });
  if (!parsed.data.length) throw invalid("Nenhuma linha encontrada. A primeira linha deve conter os cabeçalhos.");
  if (parsed.data.length > 2000) throw invalid("Importe no máximo 2.000 linhas por vez.");
  const headers = parsed.meta.fields ?? [];
  const mapped = headers.filter((h) => h in CSV_FIELDS);
  if (!mapped.some((h) => CSV_FIELDS[h as keyof typeof CSV_FIELDS] === "name")) {
    throw invalid('Coluna "nome" obrigatória. Colunas reconhecidas: nome, @/instagram, email, telefone, perfil, resumo, tags.');
  }
  const seen = new Map<string, number>();
  const rows: ImportRow[] = [];
  for (const [i, raw] of parsed.data.entries()) {
    const d: Record<string, string> = {};
    for (const h of mapped) d[CSV_FIELDS[h as keyof typeof CSV_FIELDS]] = (raw[h] ?? "").trim();
    const errors: string[] = [];
    const name = cleanText(d.name, 120) ?? "";
    if (!name) errors.push("Nome vazio");
    const email = cleanText(d.email, 200);
    if (email && !z.string().email().safeParse(email).success) errors.push("E-mail inválido");
    const profileUrl = cleanText(d.profileUrl, 300);
    if (profileUrl && !/^https?:\/\//i.test(profileUrl)) errors.push("Link do perfil inválido");
    const row: ImportRow = {
      line: i + 2,
      data: {
        name,
        username: normalizeHandle(d.username),
        email: email?.toLowerCase() ?? null,
        phone: cleanText(d.phone, 40),
        profileUrl,
        summary: cleanText(d.summary, 140),
        tags: (d.tags ?? "").split(/[;,|]/).map((t) => t.trim()).filter(Boolean).slice(0, 10),
      },
      errors,
      duplicateOf: null,
      duplicateInFile: null,
    };
    for (const key of [row.data.username && `u:${row.data.username}`, row.data.email && `e:${row.data.email}`, row.data.phone && `p:${row.data.phone}`]) {
      if (!key) continue;
      if (seen.has(key)) row.duplicateInFile = seen.get(key)!;
      else seen.set(key, row.line);
    }
    const dups = await findDuplicates(ctx.orgId, row.data);
    if (dups[0]) row.duplicateOf = { id: dups[0].id, name: dups[0].name };
    rows.push(row);
  }
  return {
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((r) => !r.errors.length && !r.duplicateOf && !r.duplicateInFile).length,
      invalid: rows.filter((r) => r.errors.length).length,
      duplicates: rows.filter((r) => r.duplicateOf || r.duplicateInFile).length,
    },
  };
}

export const commitImportSchema = z.object({
  csv: z.string().max(2_000_000),
  ownerId: z.string().uuid().nullish(),
  stageId: z.string().uuid().nullish(),
  includeLines: z.array(z.number().int()).max(2000).optional(),
});

/** Cria somente as linhas válidas e não duplicadas (ou as linhas escolhidas). Retorna relatório. */
export async function commitImport(ctx: Ctx, input: z.infer<typeof commitImportSchema>) {
  const preview = await previewImport(ctx, input.csv);
  if (input.ownerId) await assertMember(ctx.orgId, input.ownerId, { activeOnly: true });
  const include = input.includeLines ? new Set(input.includeLines) : null;
  const report = { created: 0, skippedInvalid: 0, skippedDuplicate: 0, lines: [] as { line: number; result: string }[] };
  await db.transaction(async (tx) => {
    for (const row of preview.rows) {
      if (row.errors.length) {
        report.skippedInvalid++;
        report.lines.push({ line: row.line, result: `Ignorada: ${row.errors.join(", ")}` });
        continue;
      }
      if ((row.duplicateOf || row.duplicateInFile) && !include?.has(row.line)) {
        report.skippedDuplicate++;
        report.lines.push({ line: row.line, result: row.duplicateOf ? `Duplicada de ${row.duplicateOf.name}` : `Duplicada da linha ${row.duplicateInFile}` });
        continue;
      }
      if (include && !include.has(row.line)) continue;
      const [c] = await tx
        .insert(contacts)
        .values({
          orgId: ctx.orgId,
          name: row.data.name,
          username: row.data.username,
          email: row.data.email,
          phone: row.data.phone,
          profileUrl: row.data.profileUrl ?? (row.data.username ? `https://www.instagram.com/${row.data.username}/` : null),
          summary: row.data.summary,
          ownerId: input.ownerId ?? null,
          source: "import",
        })
        .returning();
      if (row.data.tags.length) await applyTags(tx, ctx.orgId, c.id, row.data.tags);
      if (input.stageId) await addToBoard(ctx, c.id, input.stageId, tx, "Importação CSV");
      report.created++;
      report.lines.push({ line: row.line, result: "Criada" });
    }
    await audit(tx, ctx, "contacts.imported", "contact", null, { created: report.created, skippedInvalid: report.skippedInvalid, skippedDuplicate: report.skippedDuplicate });
  });
  await publish({ orgId: ctx.orgId, topic: "contacts" });
  await publish({ orgId: ctx.orgId, topic: "board" });
  return report;
}

// ---------- Mesclagem ----------
/** Mescla `secondaryId` em `primaryId`. Explícita, auditada e sem perder histórico. */
export async function mergeContacts(ctx: Ctx, primaryId: string, secondaryId: string) {
  assertCan(ctx, "contacts.merge");
  if (primaryId === secondaryId) throw invalid("Escolha dois contatos diferentes.");
  const primary = await getVisibleContact(ctx, primaryId);
  const secondary = await getVisibleContact(ctx, secondaryId);
  if (primary.mergedIntoId || secondary.mergedIntoId) throw invalid("Um dos contatos já foi mesclado.");

  await db.transaction(async (tx) => {
    await tx.update(channelIdentities).set({ contactId: primary.id }).where(eq(channelIdentities.contactId, secondary.id));

    // Conversas: se ambos têm conversa no mesmo canal, as mensagens vão para a do principal.
    const convs = await tx.select().from(conversations).where(inArray(conversations.contactId, [primary.id, secondary.id]));
    for (const sc of convs.filter((c) => c.contactId === secondary.id)) {
      const pc = convs.find((c) => c.contactId === primary.id && c.channel === sc.channel);
      if (pc) {
        await tx.update(messages).set({ conversationId: pc.id }).where(eq(messages.conversationId, sc.id));
        await tx
          .update(conversations)
          .set({
            unreadCount: pc.unreadCount + sc.unreadCount,
            lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${tsz(sc.lastMessageAt)})`,
            lastInboundAt: sql`greatest(${conversations.lastInboundAt}, ${tsz(sc.lastInboundAt)})`,
          })
          .where(eq(conversations.id, pc.id));
        await tx.delete(conversations).where(eq(conversations.id, sc.id));
      } else {
        await tx.update(conversations).set({ contactId: primary.id }).where(eq(conversations.id, sc.id));
      }
    }

    // Funil: mantém a entrada do principal; a do secundário é encerrada com histórico.
    const pEntry = await activeEntryFor(primary.id, ctx.orgId, tx);
    const sEntry = await activeEntryFor(secondary.id, ctx.orgId, tx);
    if (sEntry) {
      if (pEntry) {
        await tx.update(relationshipEntries).set({ closedAt: new Date() }).where(eq(relationshipEntries.id, sEntry.id));
        await tx.insert(stageHistory).values({
          orgId: ctx.orgId,
          entityType: "relationship",
          entityId: sEntry.id,
          contactId: primary.id,
          fromStageId: sEntry.stageId,
          fromStageName: sEntry.stageName,
          actorId: ctx.userId,
          reason: `Mesclado com ${primary.name}`,
        });
      } else {
        await tx.update(relationshipEntries).set({ contactId: primary.id }).where(eq(relationshipEntries.id, sEntry.id));
      }
    }
    // Entradas encerradas antigas também passam ao principal (histórico).
    await tx
      .update(relationshipEntries)
      .set({ contactId: primary.id })
      .where(and(eq(relationshipEntries.contactId, secondary.id), sql`${relationshipEntries.closedAt} is not null`));

    for (const table of [opportunities, tasks, notes, appointments, socialComments] as const) {
      await tx.update(table).set({ contactId: primary.id } as never).where(eq(table.contactId, secondary.id));
    }
    const secTags = await tx.select().from(contactTags).where(eq(contactTags.contactId, secondary.id));
    if (secTags.length) {
      await tx.insert(contactTags).values(secTags.map((t) => ({ contactId: primary.id, tagId: t.tagId }))).onConflictDoNothing();
    }
    // Completa campos vazios do principal com os do secundário.
    const fill: Partial<typeof contacts.$inferInsert> = {};
    for (const k of ["username", "profileUrl", "avatarUrl", "email", "phone", "summary"] as const) {
      if (!primary[k] && secondary[k]) fill[k] = secondary[k];
    }
    await tx.update(contacts).set({ ...fill, updatedAt: new Date() }).where(eq(contacts.id, primary.id));
    await tx.update(contacts).set({ mergedIntoId: primary.id, archivedAt: new Date() }).where(eq(contacts.id, secondary.id));
    await audit(tx, ctx, "contact.merged", "contact", primary.id, {
      secondaryId: secondary.id,
      secondaryName: secondary.name,
      filled: Object.keys(fill),
    });
  });
  await publish({ orgId: ctx.orgId, topic: "contacts" });
  await publish({ orgId: ctx.orgId, topic: "board" });
  await publish({ orgId: ctx.orgId, topic: "conversations" });
  return { id: primary.id };
}
