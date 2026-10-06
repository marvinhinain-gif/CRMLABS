import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, lte, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import {
  channelIdentities,
  contacts,
  contactTags,
  conversations,
  pipelineStages,
  relationshipEntries,
  stageHistory,
  tags,
  users,
} from "../db/schema";
import type { Ctx } from "../context";
import { can, contactScope } from "../permissions";
import { AppError, forbidden, notFound } from "../errors";
import { publish } from "../realtime";
import { getPipeline } from "./common";
import { getStageInOrg, listStages } from "./stages";
import { dayRange } from "../time";
import { alertLeadStage } from "./alerts";
import { logger } from "../logger";

export const boardFiltersSchema = z.object({
  q: z.string().trim().max(100).optional(),
  ownerId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  stageId: z.string().uuid().optional(),
  nextAction: z.enum(["today", "overdue", "upcoming", "none"]).optional(),
});
export type BoardFilters = z.infer<typeof boardFiltersSchema>;

const COLUMN_PAGE = 25;

function filterConditions(ctx: Ctx, f: BoardFilters): SQL[] {
  const conds: SQL[] = [contactScope(ctx), isNull(contacts.archivedAt), isNull(contacts.mergedIntoId)];
  if (f.q) {
    const term = `%${f.q.replace(/^@/, "").replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(contacts.name, term), ilike(contacts.username, term))!);
  }
  if (f.ownerId) {
    if (!can(ctx, "data.all") && f.ownerId !== ctx.userId) throw forbidden();
    conds.push(eq(contacts.ownerId, f.ownerId));
  }
  if (f.tagId) {
    conds.push(sql`exists (select 1 from ${contactTags} ct where ct.contact_id = ${contacts.id} and ct.tag_id = ${f.tagId})`);
  }
  if (f.nextAction) {
    const { start, end } = dayRange(new Date(), ctx.org.timezone);
    if (f.nextAction === "today") conds.push(and(gte(contacts.nextActionAt, start), lt(contacts.nextActionAt, end))!);
    if (f.nextAction === "overdue") conds.push(lt(contacts.nextActionAt, start));
    if (f.nextAction === "upcoming") conds.push(gte(contacts.nextActionAt, end));
    if (f.nextAction === "none") conds.push(isNull(contacts.nextActionAt));
  }
  return conds;
}

export type BoardCard = Awaited<ReturnType<typeof loadCards>>[number];

async function loadCards(ctx: Ctx, stageIds: string[], f: BoardFilters, offset: number, limit: number) {
  if (!stageIds.length) return [];
  const sq = db
    .select({
      entryId: sql<string>`${relationshipEntries.id}`.as("entry_id"),
      stageId: relationshipEntries.stageId,
      version: relationshipEntries.version,
      position: relationshipEntries.position,
      autoCreated: relationshipEntries.autoCreated,
      contactId: sql<string>`${contacts.id}`.as("contact_id"),
      name: contacts.name,
      username: contacts.username,
      avatarUrl: contacts.avatarUrl,
      summary: contacts.summary,
      nextAction: contacts.nextAction,
      nextActionAt: contacts.nextActionAt,
      ownerId: contacts.ownerId,
      ownerName: sql<string | null>`${users.name}`.as("owner_name"),
      unread: sql<number>`coalesce((select sum(${conversations.unreadCount}) from ${conversations} where ${conversations.contactId} = ${contacts.id}), 0)::int`.as("unread"),
      hasOfficialIdentity: sql<boolean>`exists (select 1 from ${channelIdentities} ci where ci.contact_id = ${contacts.id})`.as("has_official_identity"),
      rn: sql<number>`(row_number() over (partition by ${relationshipEntries.stageId} order by ${relationshipEntries.position} asc, ${relationshipEntries.updatedAt} desc))::int`.as("rn"),
    })
    .from(relationshipEntries)
    .innerJoin(contacts, eq(contacts.id, relationshipEntries.contactId))
    .leftJoin(users, eq(users.id, contacts.ownerId))
    .where(and(inArray(relationshipEntries.stageId, stageIds), isNull(relationshipEntries.closedAt), ...filterConditions(ctx, f)))
    .as("sq");
  // Paginação por coluna no banco: cada etapa carrega apenas sua página.
  const page = await db
    .select()
    .from(sq)
    .where(and(gt(sq.rn, offset), lte(sq.rn, offset + limit)))
    .orderBy(asc(sq.rn));
  const ids = page.map((r) => r.contactId);
  const tagRows = ids.length
    ? await db
        .select({ contactId: contactTags.contactId, id: tags.id, name: tags.name, color: tags.color })
        .from(contactTags)
        .innerJoin(tags, eq(tags.id, contactTags.tagId))
        .where(inArray(contactTags.contactId, ids))
    : [];
  return page.map(({ rn: _rn, ...r }) => ({
    ...r,
    tags: tagRows.filter((t) => t.contactId === r.contactId).map(({ contactId: _c, ...t }) => t),
  }));
}

async function countByStage(ctx: Ctx, stageIds: string[], f: BoardFilters) {
  if (!stageIds.length) return new Map<string, number>();
  const rows = await db
    .select({ stageId: relationshipEntries.stageId, n: sql<number>`count(*)::int` })
    .from(relationshipEntries)
    .innerJoin(contacts, eq(contacts.id, relationshipEntries.contactId))
    .where(and(inArray(relationshipEntries.stageId, stageIds), isNull(relationshipEntries.closedAt), ...filterConditions(ctx, f)))
    .groupBy(relationshipEntries.stageId);
  return new Map(rows.map((r) => [r.stageId, r.n]));
}

export async function getBoard(ctx: Ctx, f: BoardFilters) {
  let stages = await listStages(ctx, "relationship");
  if (f.stageId) stages = stages.filter((s) => s.id === f.stageId);
  const ids = stages.map((s) => s.id);
  const [cards, counts] = await Promise.all([loadCards(ctx, ids, f, 0, COLUMN_PAGE), countByStage(ctx, ids, f)]);
  return {
    stages: stages.map((s) => ({
      ...s,
      total: counts.get(s.id) ?? 0,
      cards: cards.filter((c) => c.stageId === s.id),
    })),
    pageSize: COLUMN_PAGE,
  };
}

export async function getColumnPage(ctx: Ctx, stageId: string, offset: number, f: BoardFilters) {
  await getStageInOrg(ctx.orgId, stageId, "relationship");
  return loadCards(ctx, [stageId], f, offset, COLUMN_PAGE);
}

async function assertContactVisible(ctx: Ctx, contactId: string, tx: DbOrTx = db) {
  const [c] = await tx
    .select({ id: contacts.id, ownerId: contacts.ownerId, name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!c) throw notFound("Contato não encontrado.");
  return c;
}

/** Cria a entrada do contato no funil (no máximo uma ativa por funil). Registra histórico. */
export async function addToBoard(
  ctx: Pick<Ctx, "orgId"> & { userId: string | null },
  contactId: string,
  stageId: string,
  tx: DbOrTx = db,
  reason?: string,
  extra: { origin?: string | null; productId?: string | null; createdBy?: string | null } = {},
) {
  const p = await getPipeline(ctx.orgId, "relationship", tx);
  const [stage] = await tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.pipelineId, p.id), isNull(pipelineStages.archivedAt)));
  if (!stage) throw new AppError("invalid", "Etapa inválida.");
  const [min] = await tx
    .select({ m: sql<number>`coalesce(min(${relationshipEntries.position}), 0)::int` })
    .from(relationshipEntries)
    .where(and(eq(relationshipEntries.stageId, stageId), isNull(relationshipEntries.closedAt)));
  const inserted = await tx
    .insert(relationshipEntries)
    .values({ orgId: ctx.orgId, pipelineId: p.id, contactId, stageId, position: (min?.m ?? 0) - 1, origin: extra.origin ?? null, productId: extra.productId ?? null, createdBy: extra.createdBy ?? ctx.userId })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) return null; // já possui entrada ativa
  await tx.insert(stageHistory).values({
    orgId: ctx.orgId,
    entityType: "relationship",
    entityId: inserted[0].id,
    contactId,
    fromStageId: null,
    toStageId: stage.id,
    toStageName: stage.name,
    actorId: ctx.userId,
    reason: reason ?? "Entrada no funil",
  });
  return inserted[0];
}

export const addEntrySchema = z.object({ contactId: z.string().uuid(), stageId: z.string().uuid() });

export async function addEntry(ctx: Ctx, input: z.infer<typeof addEntrySchema>) {
  const c = await assertContactVisible(ctx, input.contactId);
  const entry = await db.transaction((tx) => addToBoard(ctx, c.id, input.stageId, tx));
  if (!entry) throw new AppError("conflict", "Este contato já está no quadro.");
  await publish({ orgId: ctx.orgId, topic: "board", entityId: c.id, ownerIds: [c.ownerId] });
  return entry;
}

export const moveEntrySchema = z.object({
  toStageId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
});

/**
 * Move um cartão. Concorrência otimista: se outra pessoa moveu antes,
 * retorna 409 com o estado atual em vez de sobrescrever silenciosamente.
 */
export async function moveEntry(ctx: Ctx, entryId: string, input: z.infer<typeof moveEntrySchema>) {
  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(relationshipEntries)
      .where(and(eq(relationshipEntries.id, entryId), eq(relationshipEntries.orgId, ctx.orgId), isNull(relationshipEntries.closedAt)))
      .for("update");
    if (!entry) throw notFound("Cartão não encontrado.");
    const contact = await assertContactVisible(ctx, entry.contactId, tx);

    if (entry.version !== input.expectedVersion) {
      const [last] = await tx
        .select({ actorName: users.name, toStageName: stageHistory.toStageName, at: stageHistory.createdAt })
        .from(stageHistory)
        .leftJoin(users, eq(users.id, stageHistory.actorId))
        .where(and(eq(stageHistory.entityId, entry.id), eq(stageHistory.entityType, "relationship")))
        .orderBy(desc(stageHistory.createdAt))
        .limit(1);
      throw new AppError(
        "conflict",
        last?.actorName
          ? `${last.actorName} moveu este cartão para "${last.toStageName}" há pouco. O quadro foi atualizado.`
          : "Este cartão foi alterado por outra pessoa. O quadro foi atualizado.",
        { currentStageId: entry.stageId, currentVersion: entry.version },
      );
    }
    if (entry.stageId === input.toStageId) return { entry, contact, changed: false, fromName: null as string | null, toName: "" };

    const from = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, entry.stageId)).then((r) => r[0]);
    const [to] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.id, input.toStageId), eq(pipelineStages.pipelineId, entry.pipelineId), isNull(pipelineStages.archivedAt)));
    if (!to) throw new AppError("invalid", "Etapa de destino inválida.");

    const [min] = await tx
      .select({ m: sql<number>`coalesce(min(${relationshipEntries.position}), 0)::int` })
      .from(relationshipEntries)
      .where(and(eq(relationshipEntries.stageId, to.id), isNull(relationshipEntries.closedAt)));
    const [updated] = await tx
      .update(relationshipEntries)
      .set({ stageId: to.id, position: (min?.m ?? 0) - 1, version: entry.version + 1, updatedAt: new Date() })
      .where(eq(relationshipEntries.id, entry.id))
      .returning();
    await tx.insert(stageHistory).values({
      orgId: ctx.orgId,
      entityType: "relationship",
      entityId: entry.id,
      contactId: entry.contactId,
      fromStageId: from?.id ?? null,
      toStageId: to.id,
      fromStageName: from?.name ?? null,
      toStageName: to.name,
      actorId: ctx.userId,
    });
    return { entry: updated, contact, changed: true, fromName: from?.name ?? null, toName: to.name };
  });
  if (result.changed) {
    await publish({ orgId: ctx.orgId, topic: "board", entityId: result.contact.id, ownerIds: [result.contact.ownerId] });
    // Mover o cartão é trabalho com o contato: conta como contato realizado (uma vez por dia).
    const { recordContactMade } = await import("./salesEvents");
    await recordContactMade(ctx, result.contact.id);
    await alertLeadStage(ctx, { contactId: result.contact.id, contactName: result.contact.name, from: result.fromName, to: result.toName }).catch((e) => logger.warn("Falha no alerta de etapa", e));
  }
  return { id: result.entry.id, stageId: result.entry.stageId, version: result.entry.version };
}

/** Retira o cartão do quadro sem apagar o contato (histórico preservado). */
export async function closeEntry(ctx: Ctx, entryId: string) {
  const [entry] = await db
    .select()
    .from(relationshipEntries)
    .where(and(eq(relationshipEntries.id, entryId), eq(relationshipEntries.orgId, ctx.orgId), isNull(relationshipEntries.closedAt)));
  if (!entry) throw notFound("Cartão não encontrado.");
  const contact = await assertContactVisible(ctx, entry.contactId);
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, entry.stageId));
  await db.transaction(async (tx) => {
    await tx.update(relationshipEntries).set({ closedAt: new Date(), version: entry.version + 1 }).where(eq(relationshipEntries.id, entry.id));
    await tx.insert(stageHistory).values({
      orgId: ctx.orgId,
      entityType: "relationship",
      entityId: entry.id,
      contactId: entry.contactId,
      fromStageId: entry.stageId,
      toStageId: null,
      fromStageName: stage?.name,
      actorId: ctx.userId,
      reason: "Removido do quadro",
    });
  });
  await publish({ orgId: ctx.orgId, topic: "board", entityId: contact.id, ownerIds: [contact.ownerId] });
}

/**
 * O contato é Lead comercial? Cartão no funil criado por alguém (não automático), lead de formulário
 * ou oportunidade. Conversa ou comentário sozinhos nunca fazem de alguém um Lead.
 * `contactId` precisa ser uma referência qualificada (coluna de tabela com join, ou sql.raw).
 */
export const isRealLeadSql = (contactId: SQL | AnyColumn) =>
  sql<boolean>`(exists (select 1 from relationship_entries re where re.contact_id = ${contactId} and re.closed_at is null and not re.auto_created) or exists (select 1 from leads l where l.contact_id = ${contactId}) or exists (select 1 from opportunities o where o.contact_id = ${contactId}))`;

export async function activeEntryFor(contactId: string, orgId: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select({
      id: relationshipEntries.id,
      stageId: relationshipEntries.stageId,
      version: relationshipEntries.version,
      autoCreated: relationshipEntries.autoCreated,
      origin: relationshipEntries.origin,
      productId: relationshipEntries.productId,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
    })
    .from(relationshipEntries)
    .innerJoin(pipelineStages, eq(pipelineStages.id, relationshipEntries.stageId))
    .where(and(eq(relationshipEntries.contactId, contactId), eq(relationshipEntries.orgId, orgId), isNull(relationshipEntries.closedAt)))
    .limit(1);
  return row ?? null;
}

