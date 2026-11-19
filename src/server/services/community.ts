import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import { communityEntries, contacts, leads, leadSources, pipelineStages, stageHistory, users } from "../db/schema";
import type { Ctx } from "../context";
import { can, leadScope } from "../permissions";
import { AppError, forbidden, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, COMMUNITY_FORWARDED_KEY, COMMUNITY_NOVO_KEY, communityPipeline } from "./common";
import { buyingPowerSql } from "./leads";
import { logger } from "../logger";

const COMMUNITY_LIMIT = 500;

function assertCommunityAccess(ctx: Ctx) {
  if (!can(ctx, "data.all")) throw forbidden("O CRM da Comunidade é só para administradores e gestores.");
}

/**
 * O contato está no CRM da Comunidade (entrada ativa)? `contactId` precisa ser uma referência qualificada
 * (coluna de tabela com join, ou sql.raw).
 */
export const inCommunitySql = (contactId: SQL | AnyColumn) =>
  sql<boolean>`exists (select 1 from community_entries ce where ce.contact_id = ${contactId} and ce.closed_at is null)`;

/** Entrada ativa do contato no CRM da Comunidade, com a etapa atual (null = fora da comunidade). */
export async function communityStatusFor(orgId: string, contactId: string, tx: DbOrTx = db) {
  const [row] = await tx
    .select({
      id: communityEntries.id,
      version: communityEntries.version,
      stageId: communityEntries.stageId,
      stageKey: pipelineStages.key,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
    })
    .from(communityEntries)
    .innerJoin(pipelineStages, eq(pipelineStages.id, communityEntries.stageId))
    .where(and(eq(communityEntries.contactId, contactId), eq(communityEntries.orgId, orgId), isNull(communityEntries.closedAt)))
    .limit(1);
  return row ?? null;
}

// ---------- Quadro ----------
export const communityBoardSchema = z.object({ q: z.string().trim().max(100).optional() });

export async function getCommunityBoard(ctx: Ctx, f: z.infer<typeof communityBoardSchema> = {}) {
  assertCommunityAccess(ctx);
  const pipeline = await communityPipeline(ctx.orgId);
  const stages = await db
    .select({ id: pipelineStages.id, key: pipelineStages.key, name: pipelineStages.name, color: pipelineStages.color, position: pipelineStages.position })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, pipeline.id), isNull(pipelineStages.archivedAt)))
    .orderBy(asc(pipelineStages.position));
  const conds: SQL[] = [eq(communityEntries.orgId, ctx.orgId), isNull(communityEntries.closedAt), inArray(communityEntries.stageId, stages.map((s) => s.id))];
  if (f.q) {
    const term = `%${f.q.replace(/^@/, "").replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(contacts.name, term), ilike(contacts.username, term), ilike(contacts.phone, term))!);
  }
  const cards = await db
    .select({
      id: communityEntries.id,
      version: communityEntries.version,
      stageId: communityEntries.stageId,
      position: communityEntries.position,
      contactId: contacts.id,
      leadId: communityEntries.leadId,
      contactName: contacts.name,
      contactUsername: contacts.username,
      contactPhone: sql<string | null>`coalesce(${contacts.phone}, ${leads.phone})`,
      avatarUrl: contacts.avatarUrl,
      buyingPower: buyingPowerSql,
      sourceName: leadSources.name,
      sourceColor: leadSources.color,
      createdAt: communityEntries.createdAt,
      enteredStageAt: sql<Date | null>`(select max(h.created_at) from ${stageHistory} h where h.entity_type = 'community' and h.entity_id = ${communityEntries.id} and h.to_stage_id = ${communityEntries.stageId})`,
      opportunityId: sql<string | null>`(select o.id from opportunities o where o.contact_id = ${contacts.id} and o.status = 'open' order by o.updated_at desc limit 1)`,
      closerName: sql<string | null>`(select u.name from opportunities o join users u on u.id = o.closer_id where o.contact_id = ${contacts.id} and o.status = 'open' order by o.updated_at desc limit 1)`,
      /** SDR dono do contato (Kanban do SDR); null = sem dono. */
      sdrId: contacts.ownerId,
      sdrName: sql<string | null>`(select u.name from users u where u.id = ${contacts.ownerId})`,
    })
    .from(communityEntries)
    .innerJoin(contacts, eq(contacts.id, communityEntries.contactId))
    .leftJoin(leads, eq(leads.id, communityEntries.leadId))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(and(...conds))
    .orderBy(asc(communityEntries.position), desc(communityEntries.updatedAt))
    .limit(COMMUNITY_LIMIT);
  return { pipelineId: pipeline.id, stages, cards };
}

// ---------- Enviar leads ----------
export const addToCommunitySchema = z.object({ leadIds: z.array(z.string().uuid()).min(1).max(200) });

/** Envia leads para a etapa "Novo". Quem já está ativo na comunidade (por contato) é ignorado. */
export async function addLeadsToCommunity(ctx: Ctx, input: z.infer<typeof addToCommunitySchema>) {
  assertCommunityAccess(ctx);
  const ids = [...new Set(input.leadIds)];
  const found = await db
    .select({ id: leads.id, contactId: leads.contactId, createdAt: leads.createdAt })
    .from(leads)
    .where(and(inArray(leads.id, ids), leadScope(ctx)))
    .orderBy(asc(leads.createdAt));
  const order = new Map(ids.map((id, i) => [id, i]));
  found.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const added = await db.transaction(async (tx) => {
    const pipeline = await communityPipeline(ctx.orgId, tx);
    const list = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.pipelineId, pipeline.id), isNull(pipelineStages.archivedAt)))
      .orderBy(asc(pipelineStages.position));
    const stage = list.find((s) => s.key === COMMUNITY_NOVO_KEY) ?? list[0];
    if (!stage) throw new AppError("invalid", "O CRM da Comunidade não tem etapas.");
    const [min] = await tx
      .select({ m: sql<number>`coalesce(min(${communityEntries.position}), 0)::int` })
      .from(communityEntries)
      .where(and(eq(communityEntries.stageId, stage.id), isNull(communityEntries.closedAt)));
    let position = min?.m ?? 0;
    let n = 0;
    for (const l of found) {
      const inserted = await tx
        .insert(communityEntries)
        .values({ orgId: ctx.orgId, contactId: l.contactId, leadId: l.id, stageId: stage.id, position: position - 1, createdBy: ctx.userId })
        .onConflictDoNothing()
        .returning({ id: communityEntries.id });
      if (!inserted.length) continue; // contato já está ativo na comunidade
      position -= 1;
      n += 1;
      await tx.insert(stageHistory).values({
        orgId: ctx.orgId,
        entityType: "community",
        entityId: inserted[0].id,
        contactId: l.contactId,
        fromStageId: null,
        toStageId: stage.id,
        toStageName: stage.name,
        actorId: ctx.userId,
        reason: "Enviado para o CRM da Comunidade",
      });
      // Sai da fila de Leads como "em contato" (novo/sem resposta → em contato), como no Kanban do Social Seller.
      await tx.execute(sql`update leads set status = 'contacted', contacted_at = coalesce(contacted_at, now()), updated_at = now()
        where org_id = ${ctx.orgId} and contact_id = ${l.contactId} and status in ('new', 'no_answer')`);
      await audit(tx, ctx, "community.added", "contact", l.contactId, { leadId: l.id });
    }
    return n;
  });
  if (added) await publish({ orgId: ctx.orgId, topic: "community", managersOnly: true });
  if (added) await publish({ orgId: ctx.orgId, topic: "leads", managersOnly: true });
  return { added, skipped: input.leadIds.length - added };
}

// ---------- Mover ----------
export const moveCommunitySchema = z.object({
  toStageId: z.string().uuid(),
  /** Cartão (entrada) da etapa de destino que ficará logo abaixo do movido; sem valor, vai para o topo. */
  beforeId: z.string().uuid().optional(),
  /** Leva o cartão para o fim da etapa (soltar na área da coluna). Ignorado quando há `beforeId`. */
  toEnd: z.boolean().optional(),
  expectedVersion: z.number().int().positive(),
});

/** Move o cartão. Concorrência otimista: versão diferente da esperada vira erro "conflict". */
export async function moveCommunityEntry(ctx: Ctx, entryId: string, input: z.infer<typeof moveCommunitySchema>) {
  assertCommunityAccess(ctx);
  const result = await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(communityEntries)
      .where(and(eq(communityEntries.id, entryId), eq(communityEntries.orgId, ctx.orgId), isNull(communityEntries.closedAt)))
      .for("update");
    if (!entry) throw notFound("Cartão não encontrado.");
    if (entry.version !== input.expectedVersion) {
      const [last] = await tx
        .select({ actorName: users.name, toStageName: stageHistory.toStageName })
        .from(stageHistory)
        .leftJoin(users, eq(users.id, stageHistory.actorId))
        .where(and(eq(stageHistory.entityId, entry.id), eq(stageHistory.entityType, "community")))
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
    const [from] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, entry.stageId));
    const [to] = await tx
      .select()
      .from(pipelineStages)
      .where(and(eq(pipelineStages.id, input.toStageId), eq(pipelineStages.orgId, ctx.orgId), eq(pipelineStages.pipelineId, from.pipelineId), isNull(pipelineStages.archivedAt)));
    if (!to) throw new AppError("invalid", "Etapa de destino inválida.");
    const sameStage = to.id === entry.stageId;
    if (sameStage && !input.beforeId && !input.toEnd) return { entry, changed: false };

    if (!input.beforeId && input.toEnd) {
      // Fim da etapa: max(position)+1 entre os demais cartões ativos de destino (sem renumerar ninguém).
      const [max] = await tx
        .select({ m: sql<number | null>`max(${communityEntries.position})::int` })
        .from(communityEntries)
        .where(and(eq(communityEntries.stageId, to.id), isNull(communityEntries.closedAt), sql`${communityEntries.id} <> ${entry.id}`));
      const position = max?.m == null ? 0 : max.m + 1;
      if (sameStage && max?.m != null && entry.position > max.m) return { entry, changed: false }; // já é o último
      const [updated] = await tx
        .update(communityEntries)
        .set({ stageId: to.id, position, version: entry.version + 1, updatedAt: new Date() })
        .where(eq(communityEntries.id, entry.id))
        .returning();
      if (!sameStage) await recordMove(tx, ctx, entry, from, to);
      return { entry: updated, changed: true };
    }

    // Reposiciona: o cartão entra antes de `beforeId` (ou no topo) e a etapa de destino é renumerada.
    const others = await tx
      .select({ id: communityEntries.id })
      .from(communityEntries)
      .where(and(eq(communityEntries.stageId, to.id), isNull(communityEntries.closedAt), sql`${communityEntries.id} <> ${entry.id}`))
      .orderBy(asc(communityEntries.position), desc(communityEntries.updatedAt));
    const at = input.beforeId ? others.findIndex((o) => o.id === input.beforeId) : -1;
    const ordered = others.map((o) => o.id);
    ordered.splice(at === -1 ? 0 : at, 0, entry.id);
    for (const [i, id] of ordered.entries()) {
      if (id === entry.id) continue;
      await tx.update(communityEntries).set({ position: i }).where(eq(communityEntries.id, id));
    }
    const [updated] = await tx
      .update(communityEntries)
      .set({ stageId: to.id, position: ordered.indexOf(entry.id), version: entry.version + 1, updatedAt: new Date() })
      .where(eq(communityEntries.id, entry.id))
      .returning();
    if (!sameStage) await recordMove(tx, ctx, entry, from, to);
    return { entry: updated, changed: true };
  });
  if (result.changed) await publish({ orgId: ctx.orgId, topic: "community", entityId: result.entry.id, managersOnly: true });
  return { id: result.entry.id, stageId: result.entry.stageId, version: result.entry.version };
}

type Entry = typeof communityEntries.$inferSelect;
type Stage = typeof pipelineStages.$inferSelect;
async function recordMove(tx: DbOrTx, ctx: Ctx, entry: Entry, from: Stage | undefined, to: Stage) {
  await tx.insert(stageHistory).values({
    orgId: ctx.orgId,
    entityType: "community",
    entityId: entry.id,
    contactId: entry.contactId,
    fromStageId: from?.id ?? null,
    toStageId: to.id,
    fromStageName: from?.name ?? null,
    toStageName: to.name,
    actorId: ctx.userId,
  });
  await audit(tx, ctx, "community.moved", "contact", entry.contactId, { from: from?.name ?? null, to: to.name });
}

/** Retira o cartão do quadro (fecha a entrada); o contato e o histórico continuam. */
export async function removeCommunityEntry(ctx: Ctx, entryId: string) {
  assertCommunityAccess(ctx);
  await db.transaction(async (tx) => {
    const [entry] = await tx
      .select()
      .from(communityEntries)
      .where(and(eq(communityEntries.id, entryId), eq(communityEntries.orgId, ctx.orgId), isNull(communityEntries.closedAt)))
      .for("update");
    if (!entry) throw notFound("Cartão não encontrado.");
    const [stage] = await tx.select({ name: pipelineStages.name }).from(pipelineStages).where(eq(pipelineStages.id, entry.stageId));
    await tx.update(communityEntries).set({ closedAt: new Date(), version: entry.version + 1, updatedAt: new Date() }).where(eq(communityEntries.id, entry.id));
    await tx.insert(stageHistory).values({
      orgId: ctx.orgId,
      entityType: "community",
      entityId: entry.id,
      contactId: entry.contactId,
      fromStageId: entry.stageId,
      toStageId: null,
      fromStageName: stage?.name ?? null,
      actorId: ctx.userId,
      reason: "Removido do CRM da Comunidade",
    });
    await audit(tx, ctx, "community.removed", "contact", entry.contactId, { stage: stage?.name ?? null });
  });
  await publish({ orgId: ctx.orgId, topic: "community", entityId: entryId, managersOnly: true });
  await publish({ orgId: ctx.orgId, topic: "leads", managersOnly: true });
}

/**
 * Chamado ao encaminhar o lead ao closer (por qualquer perfil): leva a entrada ativa do contato para
 * "Encaminhado ao closer". Não confere permissão (o encaminhamento já foi autorizado) e nunca derruba quem chama.
 */
export async function markCommunityForwarded(ctx: Pick<Ctx, "orgId" | "userId">, contactId: string, closerName: string | null) {
  try {
    const moved = await db.transaction(async (tx) => {
      const [entry] = await tx
        .select()
        .from(communityEntries)
        .where(and(eq(communityEntries.contactId, contactId), eq(communityEntries.orgId, ctx.orgId), isNull(communityEntries.closedAt)))
        .for("update");
      if (!entry) return false;
      const [from] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, entry.stageId));
      const [to] = await tx
        .select()
        .from(pipelineStages)
        .where(and(eq(pipelineStages.pipelineId, from.pipelineId), eq(pipelineStages.key, COMMUNITY_FORWARDED_KEY), isNull(pipelineStages.archivedAt)));
      if (!to || to.id === entry.stageId) return false;
      const [min] = await tx
        .select({ m: sql<number>`coalesce(min(${communityEntries.position}), 0)::int` })
        .from(communityEntries)
        .where(and(eq(communityEntries.stageId, to.id), isNull(communityEntries.closedAt)));
      await tx
        .update(communityEntries)
        .set({ stageId: to.id, position: (min?.m ?? 0) - 1, version: entry.version + 1, updatedAt: new Date() })
        .where(eq(communityEntries.id, entry.id));
      await tx.insert(stageHistory).values({
        orgId: ctx.orgId,
        entityType: "community",
        entityId: entry.id,
        contactId,
        fromStageId: from.id,
        toStageId: to.id,
        fromStageName: from.name,
        toStageName: to.name,
        actorId: ctx.userId,
        reason: `Encaminhado ao closer${closerName ? ` — ${closerName}` : ""}`,
      });
      return true;
    });
    if (moved) await publish({ orgId: ctx.orgId, topic: "community", managersOnly: true });
  } catch (e) {
    logger.warn("Falha ao mover o cartão do CRM da Comunidade", e);
  }
}
