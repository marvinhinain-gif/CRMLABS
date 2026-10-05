import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { notifications, organizations, conversations, contacts } from "../db/schema";
import type { Ctx } from "../context";
import { assertCan, conversationScope } from "../permissions";
import { invalid } from "../errors";
import { publish } from "../realtime";
import { audit } from "./common";
import { getStageInOrg } from "./stages";

export async function getOrgSettings(ctx: Ctx) {
  const [o] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  return {
    name: o.name,
    timezone: o.timezone,
    isDemo: o.isDemo,
    sharedInbox: o.sharedInbox,
    autoEntryStageId: o.autoEntryStageId,
    autoCreateFromMessages: o.autoCreateFromMessages,
    autoCreateFromComments: o.autoCreateFromComments,
    retentionDaysAfterDisconnect: o.retentionDaysAfterDisconnect,
    allowSignup: o.allowSignup,
    dailyNudges: o.dailyNudges,
  };
}

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  sharedInbox: z.boolean().optional(),
  autoEntryStageId: z.string().uuid().nullable().optional(),
  autoCreateFromMessages: z.boolean().optional(),
  autoCreateFromComments: z.boolean().optional(),
  retentionDaysAfterDisconnect: z.number().int().min(30).max(3650).nullable().optional(),
  allowSignup: z.boolean().optional(),
  dailyNudges: z.boolean().optional(),
});

export async function updateOrgSettings(ctx: Ctx, input: z.infer<typeof orgSettingsSchema>) {
  // O gestor pode configurar a caixa compartilhada; demais ajustes são do administrador.
  const keys = Object.keys(input);
  if (keys.length === 1 && keys[0] === "sharedInbox") assertCan(ctx, "pipeline.edit");
  else assertCan(ctx, "org.settings", "Somente administradores alteram as configurações da organização.");
  if (input.autoEntryStageId) {
    const s = await getStageInOrg(ctx.orgId, input.autoEntryStageId, "relationship");
    if (s.archivedAt) throw invalid("Etapa arquivada.");
  }
  await db.update(organizations).set(input).where(eq(organizations.id, ctx.orgId));
  await audit(db, ctx, "org.settings", "organization", ctx.orgId, input);
  await publish({ orgId: ctx.orgId, topic: "settings" });
  return getOrgSettings(ctx);
}

export async function listNotifications(ctx: Ctx, f: { unread?: boolean; limit?: number } = {}) {
  const rows = await db
    .select({ id: notifications.id, type: notifications.type, title: notifications.title, body: notifications.body, link: notifications.link, readAt: notifications.readAt, createdAt: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), eq(notifications.orgId, ctx.orgId), f.unread ? isNull(notifications.readAt) : undefined))
    .orderBy(desc(notifications.createdAt))
    .limit(f.limit ?? 40);
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, ctx.userId), eq(notifications.orgId, ctx.orgId), isNull(notifications.readAt)));
  return { rows, unread };
}

export async function markNotificationsRead(ctx: Ctx, ids?: string[]) {
  const base = and(eq(notifications.userId, ctx.userId), eq(notifications.orgId, ctx.orgId), isNull(notifications.readAt));
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(ids?.length ? and(base, sql`${notifications.id} = any(${ids}::uuid[])`) : base);
}

/** Contadores do menu (conversas não lidas do escopo do usuário). */
export async function navCounts(ctx: Ctx) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(conversationScope(ctx), sql`${conversations.unreadCount} > 0`));
  const { newLeadCount } = await import("./leads");
  const { inboxSummary } = await import("./instagram");
  const inbox = await inboxSummary(ctx);
  return { unreadConversations: row?.n ?? 0, newLeads: await newLeadCount(ctx), pendingDirects: inbox.pendingDirects, pendingComments: inbox.pendingComments };
}
