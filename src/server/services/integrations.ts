/**
 * Integrações de captação (formulários, quizzes, webhooks).
 * CONFIGURAÇÃO: somente administradores (checado aqui, no servidor).
 * OPERAÇÃO: os leads entram pelo núcleo comum em leads.ts.
 */
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { customFields, integrationLogs, leadForms, leadSources, leads, memberships, opportunities, organizations, pipelineStages, products, appointments, type FieldMapping, type LeadQuestion } from "../db/schema";
import type { Ctx } from "../context";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../crypto";
import { appUrl } from "../env";
import { AppError, invalid, notFound } from "../errors";
import { assertCan } from "../permissions";
import { parseLocalDateTime } from "../time";
import { audit, cleanText, getPipeline, normalizeHandle, NOVO_INTERESSADO_KEY } from "./common";
import { cleanUtm, ingestLead, logIntegration, normalizeEmail, normalizePhone, QUIZ_PROVIDER } from "./leads";
import { applyMapping, normalizeFor, PROVIDERS, suggestTarget, verifySignature, type Pair, type ProviderId } from "../integrations/forms/normalize";

const ADMIN_ONLY = "Somente administradores configuram integrações.";
const assertAdmin = (ctx: Ctx) => assertCan(ctx, "integrations.manage", ADMIN_ONLY);

// ---------- Catálogo: origens, produtos, campos personalizados ----------

export const DEFAULT_SOURCES = [
  { key: "trafego-pago", name: "Tráfego Pago", color: "blue" },
  { key: "stories", name: "Stories", color: "pink" },
  { key: "conteudo-organico", name: "Conteúdo Orgânico", color: "green" },
  { key: "collab", name: "Collab", color: "lilac" },
  { key: "indicacao", name: "Indicação", color: "yellow" },
  { key: "evento", name: "Evento", color: "orange" },
  { key: "podcast", name: "Podcast", color: "teal" },
  { key: "outros", name: "Outros", color: "gray" },
];
export const DEFAULT_CUSTOM_FIELDS = [
  { key: "faturamento", label: "Faturamento" },
  { key: "dor_principal", label: "Dor principal" },
  { key: "objetivo", label: "Objetivo" },
  { key: "objecoes", label: "Objeções" },
];

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

/** Origens, produtos e campos visíveis para toda a equipe (nomes, sem nada técnico). */
export async function catalog(ctx: Ctx) {
  const [sources, prods, fields] = await Promise.all([
    db.select().from(leadSources).where(and(eq(leadSources.orgId, ctx.orgId), isNull(leadSources.archivedAt))).orderBy(asc(leadSources.position)),
    db.select().from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))).orderBy(asc(products.name)),
    db.select().from(customFields).where(and(eq(customFields.orgId, ctx.orgId), isNull(customFields.archivedAt))).orderBy(asc(customFields.position)),
  ]);
  return {
    sources: sources.map((s) => ({ id: s.id, key: s.key, name: s.name, color: s.color })),
    products: prods.map((p) => ({ id: p.id, name: p.name })),
    customFields: fields.map((f) => ({ id: f.id, key: f.key, label: f.label, showToCloser: f.showToCloser })),
  };
}

export async function createSource(ctx: Ctx, name: string) {
  assertAdmin(ctx);
  const n = cleanText(name, 60);
  if (!n || n.length < 2) throw invalid("Dê um nome à origem.");
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${leadSources.position}), 0)::int` }).from(leadSources).where(eq(leadSources.orgId, ctx.orgId));
  const [row] = await db
    .insert(leadSources)
    .values({ orgId: ctx.orgId, key: `${slug(n)}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 3)}`, name: n, position: max + 1 })
    .returning();
  await audit(db, ctx, "lead_source.created", "lead_source", row.id, { name: n });
  return row;
}

export async function createProduct(ctx: Ctx, name: string) {
  assertAdmin(ctx);
  const n = cleanText(name, 80);
  if (!n || n.length < 2) throw invalid("Dê um nome ao produto.");
  const [existing] = await db.select().from(products).where(and(eq(products.orgId, ctx.orgId), sql`lower(${products.name}) = ${n.toLowerCase()}`));
  if (existing) {
    if (existing.archivedAt) await db.update(products).set({ archivedAt: null }).where(eq(products.id, existing.id));
    return existing;
  }
  const [row] = await db.insert(products).values({ orgId: ctx.orgId, name: n }).returning();
  await audit(db, ctx, "product.created", "product", row.id, { name: n });
  return row;
}

export async function createCustomField(ctx: Ctx, label: string) {
  assertAdmin(ctx);
  const l = cleanText(label, 60);
  if (!l || l.length < 2) throw invalid("Dê um nome ao campo.");
  const key = slug(l).replace(/-/g, "_") || "campo";
  const [existing] = await db.select().from(customFields).where(and(eq(customFields.orgId, ctx.orgId), eq(customFields.key, key)));
  if (existing) {
    if (existing.archivedAt) await db.update(customFields).set({ archivedAt: null, label: l }).where(eq(customFields.id, existing.id));
    return existing;
  }
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${customFields.position}), 0)::int` }).from(customFields).where(eq(customFields.orgId, ctx.orgId));
  const [row] = await db.insert(customFields).values({ orgId: ctx.orgId, key, label: l, position: max + 1 }).returning();
  await audit(db, ctx, "custom_field.created", "custom_field", row.id, { label: l });
  return row;
}

/** Usado ao criar organizações novas. */
export async function seedCatalog(orgId: string, tx: Pick<typeof db, "insert"> = db) {
  await tx.insert(leadSources).values(DEFAULT_SOURCES.map((s, i) => ({ ...s, orgId, position: i }))).onConflictDoNothing();
  await tx.insert(customFields).values(DEFAULT_CUSTOM_FIELDS.map((f, i) => ({ ...f, orgId, position: i }))).onConflictDoNothing();
}

// ---------- Integrações (configuração) ----------

const questionSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1, "Escreva a pergunta.").max(200),
  type: z.enum(["text", "textarea", "choice", "number"]),
  required: z.boolean().default(false),
  options: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
});

const mappingSchema = z.object({
  key: z.string().trim().min(1).max(120),
  target: z.string().regex(/^(name|phone|email|instagram|product|answer|ignore|custom:[0-9a-f-]{36})$/, "Destino de campo inválido."),
});

const shape = {
  provider: z.enum(["crmlabs_form", "webhook", "typeform", "tally", "google_forms", "api"]),
  name: z.string().trim().min(2, "Dê um nome à integração.").max(120),
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
  sourceId: z.string().uuid({ message: "Escolha a origem dos leads." }),
  campaign: z.string().trim().max(160).nullable(),
  channel: z.string().trim().max(120).nullable(),
  partner: z.string().trim().max(120).nullable(),
  adName: z.string().trim().max(160).nullable(),
  productId: z.string().uuid().nullable(),
  pipelineKind: z.enum(["relationship", "sales"]),
  stageId: z.string().uuid().nullable(),
  salesStageId: z.string().uuid().nullable(),
  assignMode: z.enum(["round_robin", "fixed"]),
  fixedAssigneeId: z.string().uuid().nullable(),
  assigneeIds: z.array(z.string().uuid()).max(50),
  fieldMap: z.array(mappingSchema).max(80),
  active: z.boolean(),
};

export const integrationInputSchema = z.object({
  ...shape,
  provider: shape.provider.default("crmlabs_form"),
  slug: shape.slug.optional(),
  headline: shape.headline.optional(),
  description: shape.description.optional(),
  questions: shape.questions.default([]),
  askEmail: shape.askEmail.default(true),
  askInstagram: shape.askInstagram.default(true),
  askPreferredTime: shape.askPreferredTime.default(true),
  thankYou: shape.thankYou.optional(),
  sourceId: shape.sourceId.optional(),
  campaign: shape.campaign.optional(),
  channel: shape.channel.optional(),
  partner: shape.partner.optional(),
  adName: shape.adName.optional(),
  productId: shape.productId.optional(),
  pipelineKind: shape.pipelineKind.default("relationship"),
  stageId: shape.stageId.optional(),
  salesStageId: shape.salesStageId.optional(),
  assignMode: shape.assignMode.default("round_robin"),
  fixedAssigneeId: shape.fixedAssigneeId.optional(),
  assigneeIds: shape.assigneeIds.default([]),
  fieldMap: shape.fieldMap.default([]),
  active: shape.active.default(true),
});
/** Atualização parcial: o que não vier fica como está. */
export const integrationUpdateSchema = z.object(shape).partial();

async function uniqueSlug(base: string, exceptId?: string) {
  let s = base || "formulario";
  for (let i = 0; i < 6; i++) {
    const [hit] = await db.select({ id: leadForms.id }).from(leadForms).where(eq(leadForms.slug, s));
    if (!hit || hit.id === exceptId) return s;
    s = `${base}-${Math.floor(1000 + Math.random() * 8999)}`;
  }
  throw new AppError("conflict", "Não foi possível gerar um endereço único. Tente outro nome.");
}

async function checkRefs(ctx: Ctx, v: Partial<z.infer<typeof integrationUpdateSchema>>) {
  if (v.sourceId) {
    const [s] = await db.select({ id: leadSources.id }).from(leadSources).where(and(eq(leadSources.id, v.sourceId), eq(leadSources.orgId, ctx.orgId)));
    if (!s) throw invalid("Origem inválida.");
  }
  if (v.productId) {
    const [p] = await db.select({ id: products.id }).from(products).where(and(eq(products.id, v.productId), eq(products.orgId, ctx.orgId)));
    if (!p) throw invalid("Produto inválido.");
  }
  for (const [kind, id] of [["relationship", v.stageId], ["sales", v.salesStageId]] as const) {
    if (!id) continue;
    const p = await getPipeline(ctx.orgId, kind);
    const [s] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.id, id), eq(pipelineStages.pipelineId, p.id), isNull(pipelineStages.archivedAt)));
    if (!s) throw invalid("Etapa do funil inválida.");
  }
  const people = [...(v.assigneeIds ?? []), ...(v.fixedAssigneeId ? [v.fixedAssigneeId] : [])];
  if (people.length) {
    const rows = await db.select({ userId: memberships.userId }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), inArray(memberships.userId, people), eq(memberships.status, "active")));
    if (rows.length !== new Set(people).size) throw invalid("Algum responsável escolhido não está ativo na equipe.");
  }
  for (const m of v.fieldMap ?? []) {
    if (!m.target.startsWith("custom:")) continue;
    const [f] = await db.select({ id: customFields.id }).from(customFields).where(and(eq(customFields.id, m.target.slice(7)), eq(customFields.orgId, ctx.orgId)));
    if (!f) throw invalid("Campo personalizado inválido no mapeamento.");
  }
}

type Row = typeof leadForms.$inferSelect;

function status(f: Row): "active" | "error" | "inactive" {
  if (!f.active) return "inactive";
  if (f.lastErrorAt && (!f.lastLeadAt || f.lastErrorAt > f.lastLeadAt)) return "error";
  return "active";
}

/** Visão de administrador (inclui endereço do webhook). */
function adminView(f: Row) {
  const base = appUrl();
  let token: string | null = null;
  try {
    token = decryptSecret(f.tokenEnc);
  } catch {
    token = null;
  }
  return {
    id: f.id,
    provider: f.provider as ProviderId,
    name: f.name,
    slug: f.slug,
    headline: f.headline,
    description: f.description,
    questions: f.questions,
    askEmail: f.askEmail,
    askInstagram: f.askInstagram,
    askPreferredTime: f.askPreferredTime,
    thankYou: f.thankYou,
    sourceId: f.sourceId,
    campaign: f.campaign,
    channel: f.channel,
    partner: f.partner,
    adName: f.adName,
    productId: f.productId,
    pipelineKind: f.pipelineKind as "relationship" | "sales",
    stageId: f.stageId,
    salesStageId: f.salesStageId,
    assignMode: f.assignMode as "round_robin" | "fixed",
    fixedAssigneeId: f.fixedAssigneeId,
    assigneeIds: f.assigneeIds,
    fieldMap: f.fieldMap,
    active: f.active,
    status: status(f),
    lastError: f.lastError,
    lastErrorAt: f.lastErrorAt,
    lastLeadAt: f.lastLeadAt,
    lastSample: f.lastSample ?? [],
    hasSigningSecret: !!f.signingSecretEnc,
    publicUrl: `${base}/f/${f.slug}`,
    webhookUrl: token ? `${base}/api/public/leads/${token}` : null,
    createdAt: f.createdAt,
  };
}

async function own(ctx: Ctx, id: string) {
  const [f] = await db.select().from(leadForms).where(and(eq(leadForms.id, id), eq(leadForms.orgId, ctx.orgId), sql`${leadForms.provider} <> ${QUIZ_PROVIDER}`));
  if (!f) throw notFound("Integração não encontrada.");
  return f;
}

export async function listIntegrations(ctx: Ctx) {
  assertAdmin(ctx);
  const rows = await db.select().from(leadForms).where(and(eq(leadForms.orgId, ctx.orgId), sql`${leadForms.provider} <> ${QUIZ_PROVIDER}`)).orderBy(desc(leadForms.createdAt));
  const counts = await db.select({ formId: leads.formId, n: sql<number>`count(*)::int` }).from(leads).where(eq(leads.orgId, ctx.orgId)).groupBy(leads.formId);
  return rows.map((f) => ({ ...adminView(f), leadCount: counts.find((c) => c.formId === f.id)?.n ?? 0 }));
}

export async function getIntegration(ctx: Ctx, id: string) {
  assertAdmin(ctx);
  return adminView(await own(ctx, id));
}

export async function createIntegration(ctx: Ctx, raw: z.input<typeof integrationInputSchema>) {
  assertAdmin(ctx);
  const input = integrationInputSchema.parse(raw);
  await checkRefs(ctx, input);
  let sourceId = input.sourceId ?? null;
  if (!sourceId) {
    const [o] = await db.select({ id: leadSources.id }).from(leadSources).where(and(eq(leadSources.orgId, ctx.orgId), eq(leadSources.key, "outros")));
    sourceId = o?.id ?? null;
  }
  let stageId = input.stageId ?? null;
  if (input.stageId === undefined && input.pipelineKind === "relationship") {
    const p = await getPipeline(ctx.orgId, "relationship");
    const [s] = await db.select({ id: pipelineStages.id }).from(pipelineStages).where(and(eq(pipelineStages.pipelineId, p.id), eq(pipelineStages.key, NOVO_INTERESSADO_KEY), isNull(pipelineStages.archivedAt)));
    stageId = s?.id ?? null;
  }
  const token = randomToken(24);
  const [f] = await db
    .insert(leadForms)
    .values({
      orgId: ctx.orgId,
      provider: input.provider,
      name: input.name,
      slug: await uniqueSlug(input.slug ?? slug(input.name)),
      headline: input.headline ?? input.name,
      description: cleanText(input.description, 1000),
      questions: input.questions as LeadQuestion[],
      askEmail: input.askEmail,
      askInstagram: input.askInstagram,
      askPreferredTime: input.askPreferredTime,
      thankYou: cleanText(input.thankYou, 500),
      sourceId,
      campaign: cleanText(input.campaign, 160),
      channel: cleanText(input.channel, 120),
      partner: cleanText(input.partner, 120),
      adName: cleanText(input.adName, 160),
      productId: input.productId ?? null,
      pipelineKind: input.pipelineKind,
      stageId: input.pipelineKind === "relationship" ? stageId : null,
      salesStageId: input.pipelineKind === "sales" ? (input.salesStageId ?? null) : null,
      assignMode: input.assignMode,
      fixedAssigneeId: input.assignMode === "fixed" ? (input.fixedAssigneeId ?? null) : null,
      assigneeIds: input.assigneeIds,
      fieldMap: input.fieldMap as FieldMapping[],
      active: input.active,
      tokenHash: sha256(token),
      tokenEnc: encryptSecret(token),
    })
    .returning();
  await audit(db, ctx, "integration.created", "lead_form", f.id, { provider: input.provider });
  await logIntegration(db, f, { event: "Integração criada", result: "success", message: `Criada por ${ctx.userName}.` });
  return adminView(f);
}

export async function updateIntegration(ctx: Ctx, id: string, raw: z.input<typeof integrationUpdateSchema>) {
  assertAdmin(ctx);
  const f = await own(ctx, id);
  const input = integrationUpdateSchema.parse(raw);
  await checkRefs(ctx, input);
  const patch: Partial<typeof leadForms.$inferInsert> = { updatedAt: new Date() };
  if (input.slug !== undefined && input.slug !== f.slug) patch.slug = await uniqueSlug(input.slug, f.id);
  for (const k of ["provider", "name", "headline", "askEmail", "askInstagram", "askPreferredTime", "active", "pipelineKind", "assignMode", "sourceId", "productId", "stageId", "salesStageId", "fixedAssigneeId", "assigneeIds"] as const) {
    if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = input[k];
  }
  for (const k of ["description", "thankYou", "campaign", "channel", "partner", "adName"] as const) if (input[k] !== undefined) patch[k] = cleanText(input[k], 1000);
  if (input.questions !== undefined) patch.questions = input.questions as LeadQuestion[];
  if (input.fieldMap !== undefined) patch.fieldMap = input.fieldMap as FieldMapping[];
  const [u] = await db.update(leadForms).set(patch).where(eq(leadForms.id, f.id)).returning();
  await audit(db, ctx, "integration.updated", "lead_form", f.id, { fields: Object.keys(input) });
  if (input.active !== undefined && input.active !== f.active) {
    await logIntegration(db, u, { event: input.active ? "Integração ativada" : "Integração desativada", result: "success", message: `Por ${ctx.userName}.` });
  }
  return adminView(u);
}

export async function regenerateToken(ctx: Ctx, id: string) {
  assertAdmin(ctx);
  const f = await own(ctx, id);
  const token = randomToken(24);
  const [u] = await db.update(leadForms).set({ tokenHash: sha256(token), tokenEnc: encryptSecret(token), updatedAt: new Date() }).where(eq(leadForms.id, f.id)).returning();
  await audit(db, ctx, "integration.token_regenerated", "lead_form", f.id);
  await logIntegration(db, u, { event: "Novo endereço gerado", result: "success", message: "O endereço anterior parou de funcionar." });
  return adminView(u);
}

/** Segredo de assinatura (Typeform, Tally ou HMAC próprio). Vazio remove. */
export async function setSigningSecret(ctx: Ctx, id: string, secret: string) {
  assertAdmin(ctx);
  const f = await own(ctx, id);
  const s = secret.trim();
  if (s && (s.length < 8 || s.length > 200)) throw invalid("O segredo precisa ter entre 8 e 200 caracteres.");
  const [u] = await db.update(leadForms).set({ signingSecretEnc: s ? encryptSecret(s) : null, updatedAt: new Date() }).where(eq(leadForms.id, f.id)).returning();
  await audit(db, ctx, "integration.signing_secret", "lead_form", f.id, { set: !!s });
  return adminView(u);
}

export async function deleteIntegration(ctx: Ctx, id: string) {
  assertAdmin(ctx);
  const f = await own(ctx, id);
  // Leads já recebidos continuam (form_id vira null; nome fica nos pontos de contato e logs).
  await db.delete(leadForms).where(eq(leadForms.id, f.id));
  await audit(db, ctx, "integration.deleted", "lead_form", f.id, { name: f.name });
}

export async function listLogs(ctx: Ctx, integrationId?: string) {
  assertAdmin(ctx);
  return db
    .select()
    .from(integrationLogs)
    .where(and(eq(integrationLogs.orgId, ctx.orgId), integrationId ? eq(integrationLogs.integrationId, integrationId) : undefined))
    .orderBy(desc(integrationLogs.createdAt))
    .limit(100);
}

// ---------- Recebimento (webhook / API / Typeform / Tally / Google Forms) ----------

function decodeBody(raw: string, contentType: string) {
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new AppError("invalid", "Envie JSON ou formulário (application/x-www-form-urlencoded).");
  }
}

type Prepared = {
  name: string | null;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  productText: string | null;
  preferredAt: Date | null;
  preferredText: string | null;
  custom: Record<string, string>;
  answers: { label: string; value: string }[];
  utm: Record<string, string>;
  pairs: Pair[];
  problems: string[];
};

/** Normaliza + aplica o mapeamento. Não grava nada. */
function prepare(f: Row, body: unknown): Prepared {
  const { pairs, utm } = normalizeFor(f.provider, body);
  const m = applyMapping(pairs, f.fieldMap);
  const phone = normalizePhone(m.phone);
  const email = normalizeEmail(m.email);
  const instagram = normalizeHandle(m.instagram);
  const preferredAt = m.preferred ? parseLocalDateTime(m.preferred, "America/Bahia") : null;
  const problems: string[] = [];
  if (!m.name) problems.push("Nome não foi identificado.");
  if (m.phone && !phone) problems.push(`Telefone “${m.phone}” não parece válido.`);
  if (!m.phone) problems.push("Telefone não foi identificado.");
  if (m.email && !email) problems.push(`E-mail “${m.email}” não parece válido.`);
  if (!instagram && !pairs.some((p) => suggestTarget(p.key) === "instagram") && f.fieldMap.length && !f.fieldMap.some((x) => x.target === "instagram")) {
    problems.push("O campo “Instagram” ainda não está mapeado.");
  }
  return {
    name: cleanText(m.name, 120),
    phone,
    email,
    instagram,
    productText: cleanText(m.product, 80),
    preferredAt,
    preferredText: preferredAt ? null : cleanText(m.preferred, 200),
    custom: m.custom,
    answers: m.answers.slice(0, 60),
    utm: cleanUtm(utm),
    pairs,
    problems,
  };
}

async function recordError(f: Row, message: string) {
  await db.update(leadForms).set({ lastError: message.slice(0, 300), lastErrorAt: new Date() }).where(eq(leadForms.id, f.id));
  await logIntegration(db, f, { event: "Envio recusado", result: "error", message });
}

/** Endpoint público: identifica a integração pelo token do endereço, valida a assinatura e cria/atualiza o lead. */
export async function receiveWebhook(token: string, raw: string, headers: Headers) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) throw notFound("Endereço de integração inválido.");
  const [f] = await db.select().from(leadForms).where(eq(leadForms.tokenHash, sha256(token)));
  // Formulários & Quizzes recebem só pela própria página (score calculado no servidor).
  if (!f || f.provider === QUIZ_PROVIDER) throw notFound("Endereço de integração inválido.");
  if (!f.active) {
    await logIntegration(db, f, { event: "Envio recusado", result: "error", message: "Integração desativada no CRMLABS." });
    throw new AppError("forbidden", "Integração desativada no CRMLABS.");
  }
  let secret: string | null = null;
  if (f.signingSecretEnc) {
    try {
      secret = decryptSecret(f.signingSecretEnc);
    } catch {
      secret = null;
    }
  }
  const sig = verifySignature(f.provider, secret, raw, headers);
  if (!sig.ok) {
    await recordError(f, sig.reason ?? "Assinatura inválida.");
    throw new AppError("forbidden", sig.reason ?? "Assinatura inválida.");
  }
  const body = decodeBody(raw, headers.get("content-type") ?? "");
  const p = prepare(f, body);
  // Guarda os nomes dos campos recebidos para o administrador mapear.
  await db.update(leadForms).set({ lastSample: p.pairs.slice(0, 60).map((x) => ({ key: x.key, value: x.value.slice(0, 200) })) }).where(eq(leadForms.id, f.id));
  if (!p.phone && !p.email && !p.instagram) {
    const msg = "Campo obrigatório de contato não encontrado: envie telefone, e-mail ou Instagram.";
    await recordError(f, msg);
    throw new AppError("invalid", msg, { problems: p.problems });
  }
  const lead = await ingestLead(f, {
    name: p.name ?? p.email ?? p.phone ?? p.instagram ?? "Lead sem nome",
    phone: p.phone,
    email: p.email,
    instagram: p.instagram,
    answers: p.answers,
    custom: p.custom,
    productText: p.productText,
    preferredAt: p.preferredAt,
    preferredText: p.preferredText,
    utm: p.utm,
    channel: f.provider === "crmlabs_form" ? "webhook" : f.provider,
  });
  return { ok: true, leadId: lead.id, warnings: p.problems };
}

/** Compatibilidade com quem já usava o webhook dos formulários. */
export async function ingestWebhookLead(token: string, body: unknown) {
  return receiveWebhook(token, JSON.stringify(body), new Headers({ "content-type": "application/json" }));
}

/**
 * Testar integração: passa um envio de exemplo por todo o caminho (normalização, mapeamento, origem)
 * e mostra o que foi reconhecido. Não cria lead.
 */
export async function testIntegration(ctx: Ctx, id: string, sample?: unknown) {
  assertAdmin(ctx);
  const f = await own(ctx, id);
  let body = sample;
  if (body === undefined || body === null || (typeof body === "object" && !Object.keys(body as object).length)) {
    body =
      f.lastSample && f.lastSample.length
        ? Object.fromEntries(f.lastSample.map((x) => [x.key, x.value]))
        : f.provider === "crmlabs_form"
          ? {
              nome: "Lead de Teste",
              whatsapp: "71999990000",
              email: "teste@exemplo.com",
              instagram: "@leadteste",
              ...Object.fromEntries(f.questions.map((q) => [q.label, q.options?.[0] ?? "Resposta de teste"])),
              utm_source: "teste",
              utm_campaign: f.campaign ?? "teste",
            }
          : { nome: "Lead de Teste", whatsapp: "71999990000", email: "teste@exemplo.com", instagram: "@leadteste", utm_source: "teste" };
  }
  const p = prepare(f, body);
  const [src] = f.sourceId ? await db.select({ name: leadSources.name }).from(leadSources).where(eq(leadSources.id, f.sourceId)) : [];
  const fields = f.fieldMap.filter((m) => m.target.startsWith("custom:")).map((m) => m.target.slice(7));
  const labels = fields.length ? await db.select({ id: customFields.id, label: customFields.label }).from(customFields).where(inArray(customFields.id, fields)) : [];
  const detected = { nome: !!p.name, telefone: !!p.phone, email: !!p.email, instagram: !!p.instagram, origem: !!src, utm: Object.keys(p.utm).length > 0 };
  const ok = !!(p.phone || p.email || p.instagram);
  await logIntegration(db, f, { event: "Teste", result: ok ? "success" : "error", message: ok ? "Lead de teste reconhecido (nada foi criado no CRM)." : "Teste sem dado de contato identificado.", detected });
  return {
    ok,
    message: ok ? "Lead recebido com sucesso." : "Não identificamos telefone, e-mail ou Instagram neste envio.",
    detected,
    values: {
      nome: p.name,
      telefone: p.phone,
      email: p.email,
      instagram: p.instagram ? `@${p.instagram}` : null,
      origem: src?.name ?? null,
      campanha: f.campaign ?? p.utm.utm_campaign ?? null,
      produto: p.productText,
      horario: p.preferredAt?.toISOString() ?? p.preferredText,
    },
    custom: Object.entries(p.custom).map(([fid, value]) => ({ label: labels.find((l) => l.id === fid)?.label ?? "Campo", value })),
    answers: p.answers,
    utm: p.utm,
    problems: p.problems,
    receivedKeys: p.pairs.map((x) => x.key),
  };
}

// ---------- Resultados por origem ----------

export const metricsSchema = z.object({
  by: z.enum(["source", "campaign", "integration", "partner", "adName"]).default("source"),
  days: z.coerce.number().int().min(1).max(730).default(90),
});

/** Leads, qualificados, calls, vendas e faturamento por origem/campanha/integração/parceiro/anúncio. */
export async function originMetrics(ctx: Ctx, f: z.infer<typeof metricsSchema>) {
  assertAdmin(ctx);
  const since = new Date(Date.now() - f.days * 86400000);
  const rows = await db
    .select({
      contactId: leads.contactId,
      status: leads.status,
      createdAt: leads.createdAt,
      source: leadSources.name,
      campaign: leads.campaign,
      integration: leadForms.name,
      partner: leads.partner,
      adName: leads.adName,
    })
    .from(leads)
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(leadForms, eq(leadForms.id, leads.formId))
    .where(and(eq(leads.orgId, ctx.orgId), gte(leads.createdAt, since)))
    .limit(20000);
  const contactIds = [...new Set(rows.map((r) => r.contactId))];
  const appts = contactIds.length
    ? await db.select({ contactId: appointments.contactId, createdAt: appointments.createdAt, status: appointments.status }).from(appointments).where(and(eq(appointments.orgId, ctx.orgId), inArray(appointments.contactId, contactIds)))
    : [];
  const won = contactIds.length
    ? await db
        .select({ id: opportunities.id, contactId: opportunities.contactId, closedAt: opportunities.closedAt, valueCents: opportunities.valueCents })
        .from(opportunities)
        .where(and(eq(opportunities.orgId, ctx.orgId), eq(opportunities.status, "won"), inArray(opportunities.contactId, contactIds)))
    : [];
  const fallback = { source: "Sem origem", campaign: "Sem campanha", integration: "Integração removida", partner: "Sem parceiro", adName: "Sem anúncio" }[f.by];
  type Acc = { label: string; leads: number; people: Set<string>; qualified: number; calls: Set<string>; sales: Set<string>; revenue: Map<string, number> };
  const groups = new Map<string, Acc>();
  for (const r of rows) {
    const label = (r[f.by] as string | null) ?? fallback;
    const g = groups.get(label) ?? { label, leads: 0, people: new Set(), qualified: 0, calls: new Set(), sales: new Set(), revenue: new Map() };
    g.leads++;
    g.people.add(r.contactId);
    if (r.status === "contacted" || r.status === "scheduled") g.qualified++;
    if (appts.some((a) => a.contactId === r.contactId && a.createdAt >= r.createdAt && (a.status === "scheduled" || a.status === "done"))) g.calls.add(r.contactId);
    for (const o of won) {
      if (o.contactId === r.contactId && o.closedAt && o.closedAt >= r.createdAt) {
        g.sales.add(r.contactId);
        g.revenue.set(o.id, Number(o.valueCents));
      }
    }
    groups.set(label, g);
  }
  return [...groups.values()]
    .map((g) => {
      const revenueCents = [...g.revenue.values()].reduce((a, b) => a + b, 0);
      const sales = g.revenue.size;
      return {
        label: g.label,
        leads: g.leads,
        people: g.people.size,
        qualified: g.qualified,
        calls: g.calls.size,
        sales,
        revenueCents,
        conversion: g.people.size ? g.sales.size / g.people.size : 0,
        avgTicketCents: sales ? Math.round(revenueCents / sales) : 0,
      };
    })
    .sort((a, b) => b.leads - a.leads);
}

export { PROVIDERS };

/** Organização dona do endereço (para mensagens). */
export async function orgNameOf(orgId: string) {
  const [o] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  return o?.name ?? "";
}

// Mantém exports antigos usados por rotas/testes.
export { listIntegrations as listForms, createIntegration as createForm, updateIntegration as updateForm, deleteIntegration as deleteForm, regenerateToken as regenerateFormToken };
