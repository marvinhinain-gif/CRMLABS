import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../../db";
import { connectedAccounts, conversations, messages, organizations, socialComments, webhookEvents } from "../../db/schema";
import { audit } from "../../services/common";
import { logger } from "../../logger";

/**
 * Política de retenção: quando a organização define N dias, mensagens e comentários
 * de contas desconectadas há mais de N dias são excluídos. Contatos, cartões, notas
 * e histórico de movimentação são preservados. Eventos brutos de webhook processados
 * são mantidos por 30 dias para auditoria técnica.
 */
export async function applyRetention() {
  const orgs = await db.select().from(organizations).where(isNotNull(organizations.retentionDaysAfterDisconnect));
  for (const org of orgs) {
    const cutoff = new Date(Date.now() - org.retentionDaysAfterDisconnect! * 86400_000);
    const accounts = await db
      .select()
      .from(connectedAccounts)
      .where(and(eq(connectedAccounts.orgId, org.id), eq(connectedAccounts.status, "disconnected"), lt(connectedAccounts.disconnectedAt, cutoff)));
    for (const acc of accounts) {
      const convs = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.accountId, acc.id));
      let removed = 0;
      for (const c of convs) {
        const r = await db.delete(messages).where(eq(messages.conversationId, c.id)).returning({ id: messages.id });
        removed += r.length;
        await db.update(conversations).set({ lastMessagePreview: null, unreadCount: 0 }).where(eq(conversations.id, c.id));
      }
      const rc = await db.delete(socialComments).where(eq(socialComments.accountId, acc.id)).returning({ id: socialComments.id });
      if (removed || rc.length) {
        await audit(db, { orgId: org.id, userId: null }, "retention.applied", "connected_account", acc.id, { messages: removed, comments: rc.length });
        logger.info("Retenção aplicada", { org: org.id, messages: removed, comments: rc.length });
      }
    }
  }
  await db.delete(webhookEvents).where(and(sql`${webhookEvents.status} in ('processed','ignored')`, lt(webhookEvents.receivedAt, new Date(Date.now() - 30 * 86400_000))));
}
