import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { opportunities, pipelines, pipelineStages, relationshipEntries, stageHistory, STAGE_TYPES } from "../db/schema";
import type { Ctx } from "../context";
import { assertCan, can } from "../permissions";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, getPipeline, salesPipelineFor, STAGE_COLORS } from "./common";
import { assertMember } from "./team";
import { randomBytes } from "node:crypto";

export const pipelineKindSchema = z.enum(["relationship", "sales"]);
const colorSchema = z.enum(STAGE_COLORS);
export const stageTypeSchema = z.enum(STAGE_TYPES);

/** Tipos que o funil comercial precisa ter para o fluxo automático (entrada, venda ganha, venda perdida). */
const REQUIRED_TYPES = ["entry", "won", "lost"] as const;

/** Funil comercial a usar: closers sempre o próprio; gestores escolhem o de qualquer pessoa (null = padrão). */
export async function resolveSalesPipeline(ctx: Ctx, ownerId?: string | null) {
  if (ctx.role === "closer") return salesPipelineFor(ctx.orgId, ownerId && ownerId !== ctx.userId ? forbiddenOwner() : ctx.userId);
  if (ownerId) {
    if (ownerId !== ctx.userId && !can(ctx, "data.all")) throw forbidden();
    await assertMember(ctx.orgId, ownerId);
  }
  return salesPipelineFor(ctx.orgId, ownerId ?? null);
}
function forbiddenOwner(): never {
  throw forbidden("Você só acessa o seu próprio funil comercial.");
}

export async function listStages(ctx: Ctx, kind: "relationship" | "sales", opts: { includeArchived?: boolean; ownerId?: string | null; pipelineId?: string } = {}) {
  const pipelineId = opts.pipelineId ?? (kind === "sales" ? (await resolveSalesPipeline(ctx, opts.ownerId)).id : (await getPipeline(ctx.orgId, kind)).id);
  return db
    .select({
      id: pipelineStages.id,
      key: pipelineStages.key,
      name: pipelineStages.name,
      color: pipelineStages.color,
      position: pipelineStages.position,
      stageType: pipelineStages.stageType,
      archivedAt: pipelineStages.archivedAt,
    })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, pipelineId), opts.includeArchived ? undefined : isNull(pipelineStages.archivedAt)))
    .orderBy(asc(pipelineStages.position));
}

/** Quem edita as etapas: gestores (qualquer funil) e o closer dono do funil pessoal. */
async function assertCanEditPipeline(ctx: Ctx, pipelineId: string) {
  const [p] = await db.select().from(pipelines).where(and(eq(pipelines.id, pipelineId), eq(pipelines.orgId, ctx.orgId)));
  if (!p) throw notFound("Funil não encontrado.");
  if (p.ownerId && p.ownerId === ctx.userId) return p;
  assertCan(ctx, "pipeline.edit", p.ownerId ? "Somente o closer dono do funil e gestores alteram estas etapas." : undefined);
  return p;
}

export async function getStageInOrg(orgId: string, stageId: string, kind?: "relationship" | "sales") {
  const [s] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.id, stageId), eq(pipelineStages.orgId, orgId)));
  if (!s) throw notFound("Etapa não encontrada.");
  if (kind) {
    const [p] = await db.select({ kind: pipelines.kind }).from(pipelines).where(eq(pipelines.id, s.pipelineId));
    if (p?.kind !== kind) throw invalid("Etapa não pertence a este funil.");
  }
  return s;
}

function slugify(name: string) {
  const base = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "etapa"}-${randomBytes(3).toString("hex")}`;
}

export const createStageSchema = z.object({
  kind: pipelineKindSchema,
  name: z.string().trim().min(1, "Informe o nome da etapa.").max(60),
  color: colorSchema.default("green"),
  stageType: stageTypeSchema.optional(),
  /** Funil comercial pessoal (closer). */
  ownerId: z.string().uuid().nullish(),
});

export async function createStage(ctx: Ctx, input: z.infer<typeof createStageSchema>) {
  const p = input.kind === "sales" ? await resolveSalesPipeline(ctx, input.ownerId) : await getPipeline(ctx.orgId, input.kind);
  await assertCanEditPipeline(ctx, p.id);
  const [max] = await db
    .select({ m: sql<number>`coalesce(max(${pipelineStages.position}), -1)::int` })
    .from(pipelineStages)
    .where(eq(pipelineStages.pipelineId, p.id));
  const [stage] = await db
    .insert(pipelineStages)
    .values({ orgId: ctx.orgId, pipelineId: p.id, key: slugify(input.name), name: input.name, color: input.color, position: (max?.m ?? -1) + 1, stageType: input.kind === "sales" ? (input.stageType ?? "custom") : "custom" })
    .returning();
  await audit(db, ctx, "stage.created", "pipeline_stage", stage.id, { name: stage.name });
  await publish({ orgId: ctx.orgId, topic: input.kind === "sales" ? "opportunities" : "board" });
  return stage;
}

export const updateStageSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome da etapa.").max(60).optional(),
  color: colorSchema.optional(),
  stageType: stageTypeSchema.optional(),
});

async function assertKeepsRequiredTypes(pipelineId: string, changingId: string, nextType: string | null) {
  const [p] = await db.select({ kind: pipelines.kind }).from(pipelines).where(eq(pipelines.id, pipelineId));
  if (p?.kind !== "sales") return;
  const rows = await db
    .select({ id: pipelineStages.id, stageType: pipelineStages.stageType })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, pipelineId), isNull(pipelineStages.archivedAt)));
  const label = { entry: "Novo lead (entrada)", won: "Venda ganha", lost: "Venda perdida" } as const;
  for (const t of REQUIRED_TYPES) {
    const remaining = rows.filter((r) => (r.id === changingId ? nextType : r.stageType) === t).length;
    const had = rows.some((r) => r.stageType === t);
    if (had && remaining === 0) throw invalid(`O funil precisa de uma etapa do tipo “${label[t]}”. Troque o tipo de outra etapa antes.`);
  }
}

export async function updateStage(ctx: Ctx, stageId: string, input: z.infer<typeof updateStageSchema>) {
  const s = await getStageInOrg(ctx.orgId, stageId);
  const p = await assertCanEditPipeline(ctx, s.pipelineId);
  if (input.stageType && p.kind !== "sales") delete input.stageType;
  if (input.stageType && input.stageType !== s.stageType) await assertKeepsRequiredTypes(s.pipelineId, s.id, input.stageType);
  const [updated] = await db.update(pipelineStages).set(input).where(eq(pipelineStages.id, s.id)).returning();
  await audit(db, ctx, "stage.updated", "pipeline_stage", s.id, { before: { name: s.name, color: s.color, stageType: s.stageType }, after: input });
  await publish({ orgId: ctx.orgId, topic: p.kind === "sales" ? "opportunities" : "board" });
  return updated;
}

export async function reorderStages(ctx: Ctx, kind: "relationship" | "sales", orderedIds: string[], ownerId?: string | null) {
  const p = kind === "sales" ? await resolveSalesPipeline(ctx, ownerId) : await getPipeline(ctx.orgId, kind);
  await assertCanEditPipeline(ctx, p.id);
  const current = await listStages(ctx, kind, { pipelineId: p.id });
  const ids = new Set(current.map((s) => s.id));
  if (orderedIds.length !== current.length || orderedIds.some((id) => !ids.has(id))) {
    throw new AppError("conflict", "As etapas mudaram enquanto você editava. Recarregue e tente novamente.");
  }
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedIds.entries()) {
      await tx.update(pipelineStages).set({ position: i }).where(eq(pipelineStages.id, id));
    }
  });
  await audit(db, ctx, "stage.reordered", "pipeline", p.id, { kind, orderedIds });
  await publish({ orgId: ctx.orgId, topic: kind === "sales" ? "opportunities" : "board" });
}

/** Etapa ocupada exige destino: os cartões são movidos (com histórico) e nunca apagados. */
export async function archiveStage(ctx: Ctx, stageId: string, destinationStageId?: string | null) {
  const s = await getStageInOrg(ctx.orgId, stageId);
  await assertCanEditPipeline(ctx, s.pipelineId);
  if (s.archivedAt) throw invalid("Esta etapa já está arquivada.");
  await assertKeepsRequiredTypes(s.pipelineId, s.id, null);
  const siblings = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, s.pipelineId), isNull(pipelineStages.archivedAt)));
  if (siblings.length <= 1) throw invalid("O funil precisa de pelo menos uma etapa.");

  const activeEntries = await db
    .select()
    .from(relationshipEntries)
    .where(and(eq(relationshipEntries.stageId, s.id), isNull(relationshipEntries.closedAt)));
  const openOpps = await db
    .select()
    .from(opportunities)
    .where(and(eq(opportunities.stageId, s.id), eq(opportunities.status, "open")));
  const occupied = activeEntries.length + openOpps.length;

  let dest: typeof s | undefined;
  if (occupied > 0) {
    if (!destinationStageId) {
      throw new AppError("invalid", `Esta etapa tem ${occupied} cartão(ões). Escolha para qual etapa eles serão movidos.`, {
        occupied,
      });
    }
    dest = siblings.find((x) => x.id === destinationStageId);
    if (!dest || dest.id === s.id) throw invalid("Etapa de destino inválida.");
  }

  await db.transaction(async (tx) => {
    if (dest && activeEntries.length) {
      await tx
        .update(relationshipEntries)
        .set({ stageId: dest.id, version: sql`${relationshipEntries.version} + 1`, updatedAt: new Date() })
        .where(inArray(relationshipEntries.id, activeEntries.map((e) => e.id)));
      await tx.insert(stageHistory).values(
        activeEntries.map((e) => ({
          orgId: ctx.orgId,
          entityType: "relationship",
          entityId: e.id,
          contactId: e.contactId,
          fromStageId: s.id,
          toStageId: dest!.id,
          fromStageName: s.name,
          toStageName: dest!.name,
          actorId: ctx.userId,
          reason: "Etapa arquivada",
        })),
      );
    }
    if (dest && openOpps.length) {
      await tx
        .update(opportunities)
        .set({ stageId: dest.id, version: sql`${opportunities.version} + 1`, updatedAt: new Date() })
        .where(inArray(opportunities.id, openOpps.map((o) => o.id)));
      await tx.insert(stageHistory).values(
        openOpps.map((o) => ({
          orgId: ctx.orgId,
          entityType: "opportunity",
          entityId: o.id,
          contactId: o.contactId,
          fromStageId: s.id,
          toStageId: dest!.id,
          fromStageName: s.name,
          toStageName: dest!.name,
          actorId: ctx.userId,
          reason: "Etapa arquivada",
        })),
      );
    }
    await tx.update(pipelineStages).set({ archivedAt: new Date() }).where(eq(pipelineStages.id, s.id));
    await audit(tx, ctx, "stage.archived", "pipeline_stage", s.id, { name: s.name, movedTo: dest?.id ?? null, moved: occupied });
  });
  await publish({ orgId: ctx.orgId, topic: "board" });
  await publish({ orgId: ctx.orgId, topic: "opportunities" });
  return { moved: occupied };
}
