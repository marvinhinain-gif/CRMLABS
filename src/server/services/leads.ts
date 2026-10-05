import { and, asc, desc, eq, gt, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import { appointments, contacts, leadForms, leads, loginAttempts, memberships, organizations, pipelineStages, relationshipEntries, users, type LeadQuestion } from "../db/schema";
import type { Ctx } from "../context";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../crypto";
import { appUrl } from "../env";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { assertCan, can, leadScope } from "../permissions";
import { publish } from "../realtime";
import { parseLocalDateTime } from "../time";
import { logger } from "../logger";
import { audit, cleanText, normalizeHandle, notifyUser, NOVO_INTERESSADO_KEY, getPipeline } from "./common";
import { addToBoard } from "./board";

// ---------- Normalização ----------

/** Telefone só com dígitos e DDI (+55 quando parece brasileiro). */
export function normalizePhone(v: string | null | undefined) {
  const raw = cleanText(v, 40);
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 10 || d.length > 15) return null;
  return `+${d}`;
}

function normalizeEmail(v: string | null | undefined) {
  const e = cleanText(v, 200)?.toLowerCase() ?? null;
  return e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "ad_id", "ad_name", "adset_name", "campaign_name", "form_name", "platform"];

function cleanUtm(input: Record<string, unknown> | undefined | null) {
  const out: Record<string, string> = {};
  if (!input) return out;
  for (const k of UTM_KEYS) {
    const v = input[k];
    if (typeof v === "string" || typeof v === "number") {
      const t = cleanText(String(v), 300);
      if (t) out[k] = t;
    }
  }
  return out;
}

// ---------- Formulários (gestão) ----------

const questionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, "Escreva a pergunta.").max(200),
  type: z.enum(["text", "textarea", "choice", "number"]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

const formShape = {
  name: z.string().trim().min(2, "Dê um nome ao formulário.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/, "Use letras minúsculas, números e hífen (3 a 60)."),
  headline: z.string().trim().min(2, "Escreva o título da página.").max(160),
  description: z.string().trim().max(1000).nullable(),
  questions: z.array(questionSchema).max(25),
  askEmail: z.boolean(),
  askInstagram: z.boolean(),
  askPreferredTime: z.boolean(),
  thankYou: z.string().trim().max(500).nullable(),
  assigneeIds: z.array(z.string().uuid()).max(50),
  stageId: z.string().uuid().nullable(),
  active: z.boolean(),
};

export const formInputSchema = z.object({
  ...formShape,
  slug: formShape.slug.optional(),
  description: formShape.description.optional(),
  questions: formShape.questions.default([]),
  askEmail: formShape.askEmail.default(true),
  askInstagram: formShape.askInstagram.default(true),
  askPreferredTime: formShape.askPreferredTime.default(true),
  thankYou: formShape.thankYou.optional(),
  assigneeIds: formShape.assigneeIds.default([]),
  stageId: formShape.stageId.optional(),
  active: formShape.active.default(true),
});

/** Atualização parcial: campos ausentes ficam como estão (sem valores padrão). */
export const formUpdateSchema = z.object(formShape).partial();

function slugify(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function uniqueSlug(base: string, exceptId?: string) {
  let slug = base || "formulario";
  for (let i = 0; i < 6; i++) {
    const [hit] = await db.select({ id: leadForms.id }).from(leadForms).where(eq(leadForms.slug, slug));
    if (!hit || hit.id === exceptId) return slug;
    slug = `${base}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || Math.floor(Math.random() * 9999)}`;
  }
  throw new AppError("conflict", "Não foi possível gerar um endereço único. Tente outro nome.");
}

async function validateAssignees(orgId: string, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), inArray(memberships.userId, ids), eq(memberships.status, "active")));
  if (rows.length !== new Set(ids).size) throw invalid("Algum responsável escolhido não está ativo na equipe.");
  return [...new Set(ids)];
}

async function validateStage(orgId: string, stageId: string | null | undefined) {
  if (!stageId) return null;
  const p = await getPipeline(orgId, "relationship");
  const [s] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.pipelineId, p.id), isNull(pipelineStages.archivedAt)));
  if (!s) throw invalid("Etapa do funil inválida.");
  return s.id;
}

function publicForm(f: typeof leadForms.$inferSelect, withSecrets: boolean) {
  const base = appUrl();
  let token: string | null = null;
  if (withSecrets) {
    try {
      token = decryptSecret(f.tokenEnc);
    } catch {
      token = null;
    }
  }
  return {
    id: f.id,
    name: f.name,
    slug: f.slug,
    headline: f.headline,
    description: f.description,
    questions: f.questions,
    askEmail: f.askEmail,
    askInstagram: f.askInstagram,
    askPreferredTime: f.askPreferredTime,
    thankYou: f.thankYou,
    assigneeIds: f.assigneeIds,
    stageId: f.stageId,
    active: f.active,
    publicUrl: `${base}/f/${f.slug}`,
    webhookUrl: token ? `${base}/api/public/leads/${token}` : null,
    createdAt: f.createdAt,
  };
}

export async function listForms(ctx: Ctx) {
  assertCan(ctx, "leads.manage", "Somente administradores e gestores configuram formulários.");
  const rows = await db.select().from(leadForms).where(eq(leadForms.orgId, ctx.orgId)).orderBy(desc(leadForms.createdAt));
  const counts = await db
    .select({ formId: leads.formId, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${leads.createdAt})` })
    .from(leads)
    .where(eq(leads.orgId, ctx.orgId))
    .groupBy(leads.formId);
  return rows.map((f) => {
    const c = counts.find((x) => x.formId === f.id);
    return { ...publicForm(f, true), leadCount: c?.n ?? 0, lastLeadAt: c?.last ?? null };
  });
}

export async function createForm(ctx: Ctx, raw: z.input<typeof formInputSchema>) {
  assertCan(ctx, "leads.manage", "Somente administradores e gestores criam formulários.");
  const input = formInputSchema.parse(raw);
  const assigneeIds = await validateAssignees(ctx.orgId, input.assigneeIds);
  let stageId = await validateStage(ctx.orgId, input.stageId);
  if (input.stageId === undefined) {
    // Padrão: contatos de anúncio entram em "Novo interessado".
    const p = await getPipeline(ctx.orgId, "relationship");
    const [s] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.pipelineId, p.id), eq(pipelineStages.key, NOVO_INTERESSADO_KEY), isNull(pipelineStages.archivedAt)));
    stageId = s?.id ?? null;
  }
  const slug = await uniqueSlug(input.slug ?? slugify(input.name));
  const token = randomToken(24);
  const [f] = await db
    .insert(leadForms)
    .values({
      orgId: ctx.orgId,
      name: input.name,
      slug,
      headline: input.headline,
      description: cleanText(input.description, 1000),
      questions: input.questions as LeadQuestion[],
      askEmail: input.askEmail,
      askInstagram: input.askInstagram,
      askPreferredTime: input.askPreferredTime,
      thankYou: cleanText(input.thankYou, 500),
      assigneeIds,
      stageId,
      active: input.active,
      tokenHash: sha256(token),
      tokenEnc: encryptSecret(token),
    })
    .returning();
  await audit(db, ctx, "lead_form.created", "lead_form", f.id);
  return publicForm(f, true);
}

async function getOwnForm(ctx: Ctx, id: string) {
  const [f] = await db.select().from(leadForms).where(and(eq(leadForms.id, id), eq(leadForms.orgId, ctx.orgId)));
  if (!f) throw notFound("Formulário não encontrado.");
  return f;
}

export async function updateForm(ctx: Ctx, id: string, raw: z.input<typeof formUpdateSchema>) {
  assertCan(ctx, "leads.manage", "Somente administradores e gestores alteram formulários.");
  const f = await getOwnForm(ctx, id);
  const input = formUpdateSchema.parse(raw);
  const patch: Partial<typeof leadForms.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined && input.slug !== f.slug) patch.slug = await uniqueSlug(input.slug, f.id);
  if (input.headline !== undefined) patch.headline = input.headline;
  if (input.description !== undefined) patch.description = cleanText(input.description, 1000);
  if (input.questions !== undefined) patch.questions = input.questions as LeadQuestion[];
  for (const k of ["askEmail", "askInstagram", "askPreferredTime", "active"] as const) if (input[k] !== undefined) patch[k] = input[k];
  if (input.thankYou !== undefined) patch.thankYou = cleanText(input.thankYou, 500);
  if (input.assigneeIds !== undefined) patch.assigneeIds = await validateAssignees(ctx.orgId, input.assigneeIds);
  if (input.stageId !== undefined) patch.stageId = await validateStage(ctx.orgId, input.stageId);
  const [u] = await db.update(leadForms).set(patch).where(eq(leadForms.id, f.id)).returning();
  await audit(db, ctx, "lead_form.updated", "lead_form", f.id);
  return publicForm(u, true);
}

/** Troca o token do webhook (o endereço antigo para de funcionar na hora). */
export async function regenerateFormToken(ctx: Ctx, id: string) {
  assertCan(ctx, "leads.manage");
  const f = await getOwnForm(ctx, id);
  const token = randomToken(24);
  const [u] = await db.update(leadForms).set({ tokenHash: sha256(token), tokenEnc: encryptSecret(token), updatedAt: new Date() }).where(eq(leadForms.id, f.id)).returning();
  await audit(db, ctx, "lead_form.token_regenerated", "lead_form", f.id);
  return publicForm(u, true);
}

export async function deleteForm(ctx: Ctx, id: string) {
  assertCan(ctx, "leads.manage");
  const f = await getOwnForm(ctx, id);
  // Leads já recebidos continuam (form_id vira null).
  await db.delete(leadForms).where(eq(leadForms.id, f.id));
  await audit(db, ctx, "lead_form.deleted", "lead_form", f.id, { name: f.name });
}

// ---------- Formulário público ----------

export async function getPublicForm(slug: string) {
  const [row] = await db
    .select({ f: leadForms, orgName: organizations.name })
    .from(leadForms)
    .innerJoin(organizations, eq(organizations.id, leadForms.orgId))
    .where(and(eq(leadForms.slug, slug.toLowerCase()), eq(leadForms.active, true)));
  if (!row) return null;
  const f = row.f;
  return {
    slug: f.slug,
    orgName: row.orgName,
    headline: f.headline,
    description: f.description,
    questions: f.questions,
    askEmail: f.askEmail,
    askInstagram: f.askInstagram,
    askPreferredTime: f.askPreferredTime,
    thankYou: f.thankYou,
  };
}

export const publicSubmitSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  phone: z.string().trim().min(1, "Informe seu WhatsApp com DDD.").max(40),
  email: z.string().trim().max(200).optional().default(""),
  instagram: z.string().trim().max(60).optional().default(""),
  preferredAt: z.string().trim().max(40).optional().default(""),
  answers: z.record(z.string().max(40), z.string().max(2000)).default({}),
  consent: z.literal(true, { message: "É preciso concordar para enviar." }),
  utm: z.record(z.string(), z.string().max(300)).optional(),
  /** Campo invisível: robôs costumam preencher. */
  website: z.string().max(200).optional().default(""),
  startedAt: z.number().optional(),
});

const PUBLIC_LIMIT_PER_HOUR = 8;

export async function submitPublicForm(slug: string, raw: unknown, ip: string | null) {
  const [form] = await db.select().from(leadForms).where(and(eq(leadForms.slug, slug.toLowerCase()), eq(leadForms.active, true)));
  if (!form) throw notFound("Este formulário não está mais disponível.");
  const input = publicSubmitSchema.parse(raw);
  const thanks = { ok: true, message: form.thankYou || "Recebemos seus dados! Em breve alguém da equipe vai falar com você." };
  // Robô: responde como se tivesse dado certo, sem registrar nada.
  if (input.website || (input.startedAt && Date.now() - input.startedAt < 2500)) return thanks;

  const key = `leadform:${ip ?? "?"}`;
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), gt(loginAttempts.createdAt, sql`now() - interval '1 hour'`)));
  if (n >= PUBLIC_LIMIT_PER_HOUR) throw new AppError("rate_limited", "Muitos envios seguidos. Tente novamente mais tarde.");
  await db.insert(loginAttempts).values({ key, success: true });

  const phone = normalizePhone(input.phone);
  if (!phone) throw new AppError("invalid", "WhatsApp inválido.", { fields: { phone: "Informe o WhatsApp com DDD, só números." } });
  const email = form.askEmail && input.email ? normalizeEmail(input.email) : null;
  if (form.askEmail && input.email && !email) throw new AppError("invalid", "E-mail inválido.", { fields: { email: "Confira o e-mail." } });

  const answers: { label: string; value: string }[] = [];
  const fieldErrors: Record<string, string> = {};
  for (const q of form.questions) {
    let v = cleanText(input.answers[q.id], q.type === "textarea" ? 2000 : 500) ?? "";
    if (q.type === "choice" && v && q.options?.length && !q.options.includes(v)) v = "";
    if (q.type === "number" && v && !/^-?\d+([.,]\d+)?$/.test(v)) {
      fieldErrors[`q_${q.id}`] = "Informe um número.";
      continue;
    }
    if (q.required && !v) fieldErrors[`q_${q.id}`] = "Responda esta pergunta.";
    if (v) answers.push({ label: q.label, value: v });
  }
  let preferredAt: Date | null = null;
  if (form.askPreferredTime && input.preferredAt) {
    preferredAt = parseLocalDateTime(input.preferredAt, "America/Bahia");
    if (!preferredAt || preferredAt.getTime() < Date.now() - 3600_000) fieldErrors.preferredAt = "Escolha uma data futura.";
  }
  if (Object.keys(fieldErrors).length) throw new AppError("invalid", "Confira os campos destacados.", { fields: fieldErrors });

  await ingestLead(form, {
    name: input.name,
    phone,
    email,
    instagram: form.askInstagram ? normalizeHandle(input.instagram) : null,
    answers,
    preferredAt,
    preferredText: null,
    utm: cleanUtm(input.utm),
    channel: "form",
  });
  return thanks;
}

// ---------- Webhook (Zapier, Make, landing pages, Meta via integradores) ----------

const NAME_KEYS = ["name", "nome", "fullname", "nomecompleto", "full_name", "seunome"];
const FIRST_KEYS = ["firstname", "first_name", "primeironome"];
const LAST_KEYS = ["lastname", "last_name", "sobrenome"];
const PHONE_KEYS = ["phone", "telefone", "whatsapp", "celular", "phonenumber", "phone_number", "fone", "tel", "numerodewhatsapp"];
const EMAIL_KEYS = ["email", "e-mail", "emailaddress", "mail"];
const IG_KEYS = ["instagram", "insta", "arroba", "usuariodoinstagram", "ig"];
const PREF_KEYS = ["melhorhorario", "melhordiaehorario", "preferredtime", "preferred_time", "horario", "datareuniao"];

const norm = (k: string) => k.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9_-]/g, "");

/** Achata o corpo recebido em pares chave → valor (aceita field_data do Lead Ads da Meta). */
function flatten(body: unknown): [string, string][] {
  const out: [string, string][] = [];
  const push = (k: string, v: unknown) => {
    if (v === null || v === undefined || out.length >= 60) return;
    if (Array.isArray(v)) v = v.filter((x) => typeof x !== "object").join(", ");
    if (typeof v === "object") return;
    const s = String(v).trim();
    if (s) out.push([k.slice(0, 80), s.slice(0, 2000)]);
  };
  if (!body || typeof body !== "object") return out;
  const obj = body as Record<string, unknown>;
  const fieldData = (obj.field_data ?? (obj.data as Record<string, unknown> | undefined)?.field_data) as { name?: string; values?: unknown[] }[] | undefined;
  if (Array.isArray(fieldData)) for (const f of fieldData) if (f?.name) push(f.name, f.values);
  const fields = obj.fields ?? obj.answers ?? obj.data;
  if (fields && typeof fields === "object" && !Array.isArray(fields)) for (const [k, v] of Object.entries(fields)) push(k, v);
  if (Array.isArray(fields)) for (const f of fields as { label?: string; name?: string; key?: string; value?: unknown }[]) push(f?.label ?? f?.name ?? f?.key ?? "", f?.value);
  for (const [k, v] of Object.entries(obj)) if (!["field_data", "fields", "answers", "data"].includes(k)) push(k, v);
  return out.filter(([k]) => k);
}

export async function ingestWebhookLead(token: string, body: unknown) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) throw notFound("Endereço de webhook inválido.");
  const [form] = await db.select().from(leadForms).where(eq(leadForms.tokenHash, sha256(token)));
  if (!form) throw notFound("Endereço de webhook inválido.");
  if (!form.active) throw new AppError("forbidden", "Formulário desativado no CRMLABS.");
  const pairs = flatten(body);
  const take = (keys: string[]) => {
    const i = pairs.findIndex(([k]) => keys.includes(norm(k)));
    return i >= 0 ? pairs.splice(i, 1)[0][1] : null;
  };
  const utmSrc: Record<string, string> = {};
  for (let i = pairs.length - 1; i >= 0; i--) {
    const k = norm(pairs[i][0]);
    if (UTM_KEYS.includes(k)) {
      utmSrc[k] = pairs[i][1];
      pairs.splice(i, 1);
    }
  }
  const first = take(FIRST_KEYS);
  const last = take(LAST_KEYS);
  const phone = normalizePhone(take(PHONE_KEYS));
  const email = normalizeEmail(take(EMAIL_KEYS));
  const instagram = normalizeHandle(take(IG_KEYS));
  const prefRaw = take(PREF_KEYS);
  const name = cleanText(take(NAME_KEYS) ?? [first, last].filter(Boolean).join(" "), 120) || email || phone || "Lead sem nome";
  const ignored = new Set(["id", "created_time", "leadgen_id", "page_id", "form_id", "adgroup_id", "is_organic", "token", "secret"]);
  const answers = pairs.filter(([k]) => !ignored.has(norm(k))).map(([label, value]) => ({ label, value }));
  const preferredAt = prefRaw ? parseLocalDateTime(prefRaw, "America/Bahia") : null;
  const lead = await ingestLead(form, {
    name,
    phone,
    email,
    instagram,
    answers,
    preferredAt,
    preferredText: preferredAt ? null : cleanText(prefRaw, 200),
    utm: cleanUtm(utmSrc),
    channel: "webhook",
  });
  return { ok: true, leadId: lead.id };
}

// ---------- Entrada do lead ----------

type LeadInput = {
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  answers: { label: string; value: string }[];
  preferredAt: Date | null;
  preferredText: string | null;
  utm: Record<string, string>;
  channel: "form" | "webhook";
};

/** Social sellers ativos que podem receber o lead (rodízio). */
async function candidates(tx: DbOrTx, form: typeof leadForms.$inferSelect) {
  const conds: SQL[] = [eq(memberships.orgId, form.orgId), eq(memberships.status, "active")];
  if (form.assigneeIds.length) conds.push(inArray(memberships.userId, form.assigneeIds));
  else conds.push(eq(memberships.role, "seller"));
  const rows = await tx.select({ userId: memberships.userId }).from(memberships).where(and(...conds)).orderBy(asc(memberships.createdAt), asc(memberships.userId));
  return rows.map((r) => r.userId);
}

async function findContact(tx: DbOrTx, orgId: string, input: Pick<LeadInput, "phone" | "email" | "instagram">) {
  const ors: SQL[] = [];
  if (input.email) ors.push(sql`lower(${contacts.email}) = ${input.email}`);
  if (input.phone) ors.push(sql`regexp_replace(coalesce(${contacts.phone}, ''), '\\D', '', 'g') = ${input.phone.replace(/\D/g, "")}`);
  if (input.instagram) ors.push(sql`lower(${contacts.username}) = ${input.instagram}`);
  if (!ors.length) return null;
  const [c] = await tx
    .select()
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), isNull(contacts.mergedIntoId), isNull(contacts.archivedAt), or(...ors)))
    .orderBy(asc(contacts.createdAt))
    .limit(1);
  return c ?? null;
}

export async function ingestLead(form: typeof leadForms.$inferSelect, input: LeadInput) {
  const { lead, contactCreated } = await db.transaction(async (tx) => {
    // Trava o formulário para o rodízio não entregar dois leads seguidos à mesma pessoa.
    const [locked] = await tx.select().from(leadForms).where(eq(leadForms.id, form.id)).for("update");
    const pool = await candidates(tx, locked);
    let contact = await findContact(tx, form.orgId, input);
    let assignedTo: string | null = null;
    // Cliente que volta fica com o mesmo social seller, se ele ainda estiver ativo.
    if (contact?.ownerId) {
      const [m] = await tx.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, form.orgId), eq(memberships.userId, contact.ownerId), eq(memberships.status, "active")));
      if (m) assignedTo = contact.ownerId;
    }
    if (!assignedTo && pool.length) {
      assignedTo = pool[locked.rotation % pool.length];
      await tx.update(leadForms).set({ rotation: locked.rotation + 1 }).where(eq(leadForms.id, form.id));
    }
    let contactCreated = false;
    if (!contact) {
      [contact] = await tx
        .insert(contacts)
        .values({
          orgId: form.orgId,
          name: input.name,
          username: input.instagram,
          profileUrl: input.instagram ? `https://www.instagram.com/${input.instagram}/` : null,
          email: input.email,
          phone: input.phone,
          ownerId: assignedTo,
          source: "lead_form",
          summary: `Lead do anúncio · ${form.name}`,
          lastInteractionAt: new Date(),
        })
        .returning();
      contactCreated = true;
    } else {
      const patch: Partial<typeof contacts.$inferInsert> = { lastInteractionAt: new Date(), updatedAt: new Date() };
      if (!contact.ownerId && assignedTo) patch.ownerId = assignedTo;
      if (!contact.email && input.email) patch.email = input.email;
      if (!contact.phone && input.phone) patch.phone = input.phone;
      if (!contact.username && input.instagram) patch.username = input.instagram;
      [contact] = await tx.update(contacts).set(patch).where(eq(contacts.id, contact.id)).returning();
    }
    if (form.stageId) {
      const [onBoard] = await tx.select({ id: relationshipEntries.id }).from(relationshipEntries).where(and(eq(relationshipEntries.contactId, contact.id), isNull(relationshipEntries.closedAt)));
      if (!onBoard) {
        try {
          await addToBoard({ orgId: form.orgId, userId: null }, contact.id, form.stageId, tx, `Lead do anúncio · ${form.name}`);
        } catch (e) {
          logger.warn("Etapa do formulário indisponível; lead entrou sem cartão", e);
        }
      }
    }
    const [lead] = await tx
      .insert(leads)
      .values({
        orgId: form.orgId,
        formId: form.id,
        contactId: contact.id,
        assignedTo,
        name: input.name,
        phone: input.phone,
        email: input.email,
        instagram: input.instagram,
        answers: input.answers,
        preferredAt: input.preferredAt,
        preferredText: input.preferredText,
        utm: input.utm,
        channel: input.channel,
      })
      .returning();
    await audit(tx, { orgId: form.orgId, userId: null }, "lead.received", "lead", lead.id, { formId: form.id, channel: input.channel, assignedTo });
    return { lead, contactCreated };
  });

  // Notificação somente para o social seller que recebeu o lead.
  const body = [form.name, input.preferredAt ? `prefere ${fmtWhen(input.preferredAt)}` : null].filter(Boolean).join(" · ");
  if (lead.assignedTo) {
    await notifyUser({ orgId: form.orgId, userId: lead.assignedTo, type: "lead.new", title: `Novo lead: ${lead.name}`, body, link: `/leads?lead=${lead.id}` }).catch((e) => logger.warn("Falha ao avisar o social seller", e));
  } else {
    // Ninguém para receber: avisa os administradores para o lead não se perder.
    const admins = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, form.orgId), eq(memberships.role, "admin"), eq(memberships.status, "active")));
    for (const a of admins) {
      await notifyUser({ orgId: form.orgId, userId: a.userId, type: "lead.unassigned", title: `Lead sem responsável: ${lead.name}`, body: `${form.name} · nenhum social seller ativo para receber`, link: `/leads?lead=${lead.id}` }).catch(() => {});
    }
  }
  await publish({ orgId: form.orgId, topic: "leads", entityId: lead.id, ownerIds: [lead.assignedTo] });
  if (contactCreated || form.stageId) await publish({ orgId: form.orgId, topic: "board", entityId: lead.contactId, ownerIds: [lead.assignedTo] });
  return lead;
}

function fmtWhen(d: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

// ---------- Leads (equipe) ----------

export const listLeadsSchema = z.object({
  status: z.enum(["new", "contacted", "scheduled", "no_answer", "disqualified", "all", "open"]).default("open"),
  formId: z.string().uuid().optional(),
  assignedTo: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

const PAGE = 30;

export async function listLeads(ctx: Ctx, f: z.infer<typeof listLeadsSchema>) {
  const conds: SQL[] = [leadScope(ctx)];
  if (f.status === "open") conds.push(inArray(leads.status, ["new", "contacted", "no_answer"]));
  else if (f.status !== "all") conds.push(eq(leads.status, f.status));
  if (f.formId) conds.push(eq(leads.formId, f.formId));
  if (f.assignedTo && can(ctx, "data.all")) conds.push(eq(leads.assignedTo, f.assignedTo));
  if (f.q) {
    const like = `%${f.q.replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(leads.name, like), ilike(leads.email, like), ilike(leads.phone, like), ilike(leads.instagram, like))!);
  }
  const where = and(...conds);
  const rows = await db
    .select({
      id: leads.id,
      name: leads.name,
      phone: leads.phone,
      email: leads.email,
      instagram: leads.instagram,
      status: leads.status,
      createdAt: leads.createdAt,
      preferredAt: leads.preferredAt,
      preferredText: leads.preferredText,
      contactId: leads.contactId,
      assignedTo: leads.assignedTo,
      assignedName: users.name,
      formName: leadForms.name,
      utmCampaign: sql<string | null>`${leads.utm}->>'utm_campaign'`,
      appointmentAt: appointments.startsAt,
    })
    .from(leads)
    .leftJoin(users, eq(users.id, leads.assignedTo))
    .leftJoin(leadForms, eq(leadForms.id, leads.formId))
    .leftJoin(appointments, eq(appointments.id, leads.appointmentId))
    .where(where)
    .orderBy(desc(leads.createdAt))
    .limit(PAGE)
    .offset((f.page - 1) * PAGE);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(leads).where(where);
  const counts = await db
    .select({ status: leads.status, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(leadScope(ctx))
    .groupBy(leads.status);
  return { rows, total, page: f.page, pageSize: PAGE, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number> };
}

async function getVisibleLead(ctx: Ctx, id: string) {
  const [l] = await db.select().from(leads).where(and(eq(leads.id, id), leadScope(ctx)));
  if (!l) throw notFound("Lead não encontrado.");
  return l;
}

export async function getLead(ctx: Ctx, id: string) {
  const l = await getVisibleLead(ctx, id);
  const [form] = l.formId ? await db.select({ name: leadForms.name, slug: leadForms.slug }).from(leadForms).where(eq(leadForms.id, l.formId)) : [];
  const [assigned] = l.assignedTo ? await db.select({ name: users.name }).from(users).where(eq(users.id, l.assignedTo)) : [];
  const [contact] = await db.select({ id: contacts.id, name: contacts.name, avatarUrl: contacts.avatarUrl, username: contacts.username, ownerId: contacts.ownerId }).from(contacts).where(eq(contacts.id, l.contactId));
  let appointment = null;
  if (l.appointmentId) {
    const [a] = await db
      .select({ id: appointments.id, startsAt: appointments.startsAt, endsAt: appointments.endsAt, status: appointments.status, title: appointments.title, ownerName: users.name, location: appointments.location })
      .from(appointments)
      .leftJoin(users, eq(users.id, appointments.ownerId))
      .where(eq(appointments.id, l.appointmentId));
    appointment = a ?? null;
  }
  const previous = await db
    .select({ id: leads.id, createdAt: leads.createdAt, formName: leadForms.name })
    .from(leads)
    .leftJoin(leadForms, eq(leadForms.id, leads.formId))
    .where(and(eq(leads.contactId, l.contactId), leadScope(ctx), sql`${leads.id} <> ${l.id}`))
    .orderBy(desc(leads.createdAt))
    .limit(5);
  return { ...l, formName: form?.name ?? null, assignedName: assigned?.name ?? null, contact, appointment, previous };
}

export const updateLeadSchema = z.object({
  status: z.enum(["new", "contacted", "no_answer", "disqualified"]).optional(),
  assignedTo: z.string().uuid().nullable().optional(),
});

export async function updateLead(ctx: Ctx, id: string, input: z.infer<typeof updateLeadSchema>) {
  const l = await getVisibleLead(ctx, id);
  const patch: Partial<typeof leads.$inferInsert> = { updatedAt: new Date() };
  if (input.status) {
    if (l.status === "scheduled" && input.status !== "disqualified") throw invalid("Este lead já tem reunião. Altere a reunião em Agendamentos.");
    patch.status = input.status;
    if (input.status === "contacted" && !l.contactedAt) patch.contactedAt = new Date();
  }
  if (input.assignedTo !== undefined && input.assignedTo !== l.assignedTo) {
    if (!can(ctx, "contacts.assign")) throw forbidden("Somente gestores redistribuem leads.");
    if (input.assignedTo) {
      const [m] = await db.select({ id: memberships.id }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, input.assignedTo), eq(memberships.status, "active")));
      if (!m) throw invalid("Responsável inválido.");
    }
    patch.assignedTo = input.assignedTo;
  }
  const [u] = await db.update(leads).set(patch).where(eq(leads.id, l.id)).returning();
  if (patch.assignedTo) {
    // Contato acompanha o lead quando ainda não tinha dono.
    await db.update(contacts).set({ ownerId: patch.assignedTo }).where(and(eq(contacts.id, l.contactId), isNull(contacts.ownerId)));
    if (patch.assignedTo !== ctx.userId) {
      await notifyUser({ orgId: ctx.orgId, userId: patch.assignedTo, type: "lead.new", title: `Lead para você: ${l.name}`, body: `Repassado por ${ctx.userName}`, link: `/leads?lead=${l.id}` });
    }
  }
  await audit(db, ctx, "lead.updated", "lead", l.id, { ...input });
  await publish({ orgId: ctx.orgId, topic: "leads", entityId: l.id, ownerIds: [l.assignedTo, u.assignedTo] });
  return u;
}

export const scheduleLeadSchema = z
  .object({
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    title: z.string().trim().max(160).optional(),
    ownerId: z.string().uuid().nullish(),
    location: z.string().trim().max(300).nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "O fim deve ser depois do início.", path: ["endsAt"] });

/** O social seller confirma a reunião com o lead: cria o agendamento e marca o lead como agendado. */
export async function scheduleLead(ctx: Ctx, id: string, input: z.infer<typeof scheduleLeadSchema>) {
  const l = await getVisibleLead(ctx, id);
  if (l.status === "scheduled" && l.appointmentId) {
    const [a] = await db.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, l.appointmentId));
    if (a && a.status === "scheduled") throw new AppError("conflict", "Este lead já tem uma reunião marcada. Remarque em Agendamentos.");
  }
  if (input.startsAt.getTime() < Date.now() - 3600_000) throw invalid("Escolha um horário futuro.");
  const { createAppointment } = await import("./commercial");
  const a = await createAppointment(ctx, {
    contactId: l.contactId,
    ownerId: input.ownerId ?? ctx.userId,
    title: input.title || `Reunião com ${l.name}`,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    timezone: "America/Bahia",
    location: input.location ?? null,
    notes: input.notes ?? null,
  });
  await db.update(appointments).set({ leadId: l.id }).where(eq(appointments.id, a.id));
  const [u] = await db
    .update(leads)
    .set({ status: "scheduled", appointmentId: a.id, contactedAt: l.contactedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(leads.id, l.id))
    .returning();
  await audit(db, ctx, "lead.scheduled", "lead", l.id, { appointmentId: a.id });
  await publish({ orgId: ctx.orgId, topic: "leads", entityId: l.id, ownerIds: [l.assignedTo] });
  return { lead: u, appointment: a };
}

/** Quantidade de leads novos do usuário (selo no menu). */
export async function newLeadCount(ctx: Ctx) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(leadScope(ctx), eq(leads.status, "new"), can(ctx, "data.all") ? undefined : eq(leads.assignedTo, ctx.userId)));
  return n;
}
