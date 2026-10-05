import { and, eq, isNull } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { auditEvents, customFields, leadSources, notifications, pipelines, pipelineStages, organizations, type StageType } from "../db/schema";
import type { Ctx } from "../context";
import { publish } from "../realtime";

export const STAGE_COLORS = ["green", "blue", "yellow", "lilac", "pink", "orange", "teal", "gray"] as const;
export type StageColor = (typeof STAGE_COLORS)[number];

export const NOVO_INTERESSADO_KEY = "novo-interessado";

export const DEFAULT_RELATIONSHIP_STAGES: { key: string; name: string; color: StageColor }[] = [
  { key: "engajado-1", name: "Engajado #1", color: "green" },
  { key: "seguidor-engajado-2", name: "Seguidor Engajado #2", color: "blue" },
  { key: "em-relacionamento", name: "Em relacionamento", color: "yellow" },
  { key: NOVO_INTERESSADO_KEY, name: "Novo interessado", color: "lilac" },
  { key: "em-qualificacao", name: "Em qualificação", color: "pink" },
  { key: "encaminhado-closer", name: "Encaminhado ao closer", color: "teal" },
];

/** Funil comercial padrão da organização (oportunidades ainda sem closer). */
export const DEFAULT_SALES_STAGES: { key: string; name: string; color: StageColor; stageType: StageType }[] = [
  { key: "qualificacao", name: "Qualificação", color: "blue", stageType: "entry" },
  { key: "reuniao-agendada", name: "Reunião agendada", color: "yellow", stageType: "scheduled" },
  { key: "proposta-enviada", name: "Proposta enviada", color: "lilac", stageType: "negotiation" },
  { key: "negociacao", name: "Negociação", color: "green", stageType: "negotiation" },
  { key: "fechado", name: "Fechado", color: "green", stageType: "won" },
  { key: "perdido", name: "Perdido", color: "gray", stageType: "lost" },
];

/** Kanban comercial de cada closer (ele pode renomear, criar, reordenar e excluir etapas). */
export const DEFAULT_CLOSER_STAGES: { key: string; name: string; color: StageColor; stageType: StageType }[] = [
  { key: "novo-lead", name: "Novo Lead", color: "blue", stageType: "entry" },
  { key: "contato-realizado", name: "Contato realizado", color: "teal", stageType: "contacted" },
  { key: "reuniao-agendada", name: "Reunião agendada", color: "yellow", stageType: "scheduled" },
  { key: "reuniao-realizada", name: "Reunião realizada", color: "lilac", stageType: "meeting_done" },
  { key: "follow-up", name: "Follow-up", color: "orange", stageType: "follow_up" },
  { key: "negociacao", name: "Negociação", color: "pink", stageType: "negotiation" },
  { key: "fechado", name: "Fechado", color: "green", stageType: "won" },
  { key: "perdido", name: "Perdido", color: "gray", stageType: "lost" },
];

/** Cria organização com funis padrão. */
export async function createOrganization(input: { name: string; isDemo?: boolean }, tx: DbOrTx = db) {
  const [org] = await tx.insert(organizations).values({ name: input.name, isDemo: input.isDemo ?? false }).returning();
  const [rel] = await tx
    .insert(pipelines)
    .values({ orgId: org.id, kind: "relationship", name: "Relacionamento" })
    .returning();
  const [sales] = await tx.insert(pipelines).values({ orgId: org.id, kind: "sales", name: "Comercial" }).returning();
  const relStages = await tx
    .insert(pipelineStages)
    .values(DEFAULT_RELATIONSHIP_STAGES.map((s, i) => ({ ...s, orgId: org.id, pipelineId: rel.id, position: i })))
    .returning();
  await tx.insert(pipelineStages).values(DEFAULT_SALES_STAGES.map((s, i) => ({ ...s, orgId: org.id, pipelineId: sales.id, position: i })));
  await tx.update(organizations).set({ autoEntryStageId: relStages[0].id }).where(eq(organizations.id, org.id));
  // Origens e campos personalizados padrão (integrações de captação).
  const { DEFAULT_SOURCES, DEFAULT_CUSTOM_FIELDS } = await import("./integrations");
  await tx.insert(leadSources).values(DEFAULT_SOURCES.map((x, i) => ({ ...x, orgId: org.id, position: i }))).onConflictDoNothing();
  await tx.insert(customFields).values(DEFAULT_CUSTOM_FIELDS.map((x, i) => ({ ...x, orgId: org.id, position: i }))).onConflictDoNothing();
  return org;
}

export async function getPipeline(orgId: string, kind: "relationship" | "sales", tx: DbOrTx = db) {
  const [p] = await tx
    .select()
    .from(pipelines)
    .where(and(eq(pipelines.orgId, orgId), eq(pipelines.kind, kind), isNull(pipelines.ownerId)))
    .limit(1);
  if (!p) throw new Error(`Funil ${kind} ausente para a organização`);
  return p;
}

/** Funil comercial pessoal do closer; criado com as etapas padrão na primeira vez. */
export async function closerPipeline(orgId: string, userId: string, tx: DbOrTx = db) {
  const find = () =>
    tx
      .select()
      .from(pipelines)
      .where(and(eq(pipelines.orgId, orgId), eq(pipelines.kind, "sales"), eq(pipelines.ownerId, userId)))
      .limit(1)
      .then((r) => r[0]);
  const existing = await find();
  if (existing) return existing;
  const [created] = await tx.insert(pipelines).values({ orgId, kind: "sales", name: "Comercial", ownerId: userId }).onConflictDoNothing().returning();
  if (!created) return (await find())!;
  await tx.insert(pipelineStages).values(DEFAULT_CLOSER_STAGES.map((s, i) => ({ ...s, orgId, pipelineId: created.id, position: i })));
  return created;
}

/** Funil onde ficam as oportunidades de um closer (ou o padrão, sem closer). */
export async function salesPipelineFor(orgId: string, closerId: string | null | undefined, tx: DbOrTx = db) {
  return closerId ? closerPipeline(orgId, closerId, tx) : getPipeline(orgId, "sales", tx);
}

export async function audit(
  tx: DbOrTx,
  ctx: Pick<Ctx, "orgId"> & { userId?: string | null },
  action: string,
  entityType: string,
  entityId: string | null,
  data?: Record<string, unknown>,
) {
  await tx.insert(auditEvents).values({
    orgId: ctx.orgId,
    actorId: ctx.userId ?? null,
    action,
    entityType,
    entityId,
    data: data ?? null,
  });
}

/** Alerta interno (não envia e-mail nem mensagem externa). */
export async function notifyUser(
  input: { orgId: string; userId: string; type: string; title: string; body?: string; link?: string; dedupeKey?: string },
  tx: DbOrTx = db,
) {
  // Com dedupeKey, a mesma notificação nunca é criada duas vezes para a mesma pessoa.
  const rows = await tx.insert(notifications).values(input).onConflictDoNothing().returning({ id: notifications.id });
  if (rows.length) await publish({ orgId: input.orgId, topic: "notifications", userId: input.userId });
  return rows.length > 0;
}

export function cleanText(v: string | null | undefined, max = 2000) {
  if (v == null) return null;
  const t = v.replace(/\u0000/g, "").trim();
  return t ? t.slice(0, max) : null;
}

export function normalizeHandle(v: string | null | undefined) {
  const t = cleanText(v, 60);
  if (!t) return null;
  return t.replace(/^@+/, "").replace(/\s+/g, "").toLowerCase() || null;
}
