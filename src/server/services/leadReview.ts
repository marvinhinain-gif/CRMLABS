/**
 * Revisão dos cartões que entraram sozinhos no Kanban do Social Seller pela regra antiga
 * ("Mensagem recebida" / "Comentário recebido"). Somente administradores.
 * Nada é apagado: "Remover do Kanban" fecha o cartão (contato, conversa e histórico ficam);
 * "Manter como Lead" confirma o cartão. Sempre uma decisão de uma pessoa, registrada no histórico.
 */
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contacts, pipelineStages, relationshipEntries, stageHistory, users } from "../db/schema";
import type { Ctx } from "../context";
import { forbidden, invalid } from "../errors";
import { publish } from "../realtime";
import { audit } from "./common";

const assertAdmin = (ctx: Ctx) => {
  if (ctx.role !== "admin") throw forbidden("Somente administradores revisam os Leads criados automaticamente.");
};

export async function listAutoEntries(ctx: Ctx) {
  assertAdmin(ctx);
  const rows = await db
    .select({
      entryId: relationshipEntries.id,
      createdAt: relationshipEntries.createdAt,
      origin: relationshipEntries.origin,
      stageName: pipelineStages.name,
      stageColor: pipelineStages.color,
      contactId: contacts.id,
      name: contacts.name,
      username: contacts.username,
      avatarUrl: contacts.avatarUrl,
      ownerName: users.name,
      conversationId: sql<string | null>`(select cv.id from conversations cv where cv.contact_id = ${contacts.id} limit 1)`,
      lastMessageAt: sql<string | null>`(select cv.last_message_at from conversations cv where cv.contact_id = ${contacts.id} limit 1)`,
      lastMessagePreview: sql<string | null>`(select cv.last_message_preview from conversations cv where cv.contact_id = ${contacts.id} limit 1)`,
      // Sinais de que alguém da equipe já trabalhou o contato (ajudam a decidir; nada é decidido sozinho).
      movedByTeam: sql<boolean>`exists (select 1 from stage_history sh where sh.entity_id = ${relationshipEntries.id} and sh.entity_type = 'relationship' and sh.actor_id is not null)`,
      repliedByTeam: sql<boolean>`exists (select 1 from messages m join conversations cv on cv.id = m.conversation_id where cv.contact_id = ${contacts.id} and m.direction = 'out')`,
      hasTasksOrNotes: sql<boolean>`(exists (select 1 from tasks t where t.contact_id = ${contacts.id}) or exists (select 1 from notes n where n.contact_id = ${contacts.id}))`,
    })
    .from(relationshipEntries)
    .innerJoin(contacts, eq(contacts.id, relationshipEntries.contactId))
    .innerJoin(pipelineStages, eq(pipelineStages.id, relationshipEntries.stageId))
    .leftJoin(users, eq(users.id, contacts.ownerId))
    .where(and(eq(relationshipEntries.orgId, ctx.orgId), eq(relationshipEntries.autoCreated, true), isNull(relationshipEntries.closedAt)))
    .orderBy(desc(relationshipEntries.createdAt))
    .limit(500);
  return { rows, total: rows.length };
}

export async function countAutoEntries(orgId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(relationshipEntries)
    .where(and(eq(relationshipEntries.orgId, orgId), eq(relationshipEntries.autoCreated, true), isNull(relationshipEntries.closedAt)));
  return r?.n ?? 0;
}

export const reviewSchema = z.object({
  entryIds: z.array(z.string().uuid()).min(1).max(50),
  action: z.enum(["keep", "remove"]),
});

export async function reviewAutoEntries(ctx: Ctx, input: z.infer<typeof reviewSchema>) {
  assertAdmin(ctx);
  const entries = await db
    .select({ id: relationshipEntries.id, contactId: relationshipEntries.contactId, stageId: relationshipEntries.stageId, version: relationshipEntries.version, stageName: pipelineStages.name, name: contacts.name, username: contacts.username })
    .from(relationshipEntries)
    .innerJoin(pipelineStages, eq(pipelineStages.id, relationshipEntries.stageId))
    .innerJoin(contacts, eq(contacts.id, relationshipEntries.contactId))
    .where(and(inArray(relationshipEntries.id, input.entryIds), eq(relationshipEntries.orgId, ctx.orgId), eq(relationshipEntries.autoCreated, true), isNull(relationshipEntries.closedAt)));
  if (!entries.length) throw invalid("Nenhum cartão automático pendente entre os selecionados.");
  await db.transaction(async (tx) => {
    for (const e of entries) {
      if (input.action === "keep") {
        await tx.update(relationshipEntries).set({ autoCreated: false, createdBy: ctx.userId, updatedAt: new Date() }).where(eq(relationshipEntries.id, e.id));
      } else {
        await tx.update(relationshipEntries).set({ closedAt: new Date(), version: e.version + 1 }).where(eq(relationshipEntries.id, e.id));
        await tx.insert(stageHistory).values({ orgId: ctx.orgId, entityType: "relationship", entityId: e.id, contactId: e.contactId, fromStageId: e.stageId, fromStageName: e.stageName, toStageId: null, actorId: ctx.userId, reason: "Removido na revisão de Leads automáticos" });
      }
      await audit(tx, ctx, input.action === "keep" ? "instagram.lead_review_kept" : "instagram.lead_review_removed", "contact", e.contactId, { username: e.username, name: e.name, stage: e.stageName });
    }
  });
  await publish({ orgId: ctx.orgId, topic: "board" });
  await publish({ orgId: ctx.orgId, topic: "conversations" });
  return { updated: entries.length };
}
