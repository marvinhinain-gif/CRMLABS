/**
 * Relacionamento do contato com o Instagram da empresa: se segue a conta, desde quando sabemos disso
 * e o que já fez (mensagens no Direct, respostas e menções em Stories, comentários).
 * A API da Meta não informa a data em que a pessoa começou a seguir; mostramos a primeira vez que
 * o CRM confirmou e há quanto tempo ela interage com a conta.
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { channelIdentities, connectedAccounts, contacts, conversations, messages, socialComments } from "../db/schema";
import type { Ctx } from "../context";
import { notFound } from "../errors";
import { contactScope } from "../permissions";
import { enrichProfile } from "../integrations/instagram/processor";
import { logger } from "../logger";

const REFRESH_EVERY_MS = 10 * 60_000;

async function visibleContact(ctx: Ctx, contactId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(contactId)) throw notFound("Contato não encontrado.");
  const [c] = await db.select({ id: contacts.id, username: contacts.username }).from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!c) throw notFound("Contato não encontrado.");
  return c;
}

export async function instagramRelationship(ctx: Ctx, contactId: string) {
  const c = await visibleContact(ctx, contactId);
  const ids = await db
    .select({
      id: channelIdentities.id,
      accountUsername: connectedAccounts.username,
      accountStatus: connectedAccounts.status,
      followsBusiness: channelIdentities.followsBusiness,
      followFirstSeenAt: channelIdentities.followFirstSeenAt,
      followCheckedAt: channelIdentities.followCheckedAt,
      followerCount: channelIdentities.followerCount,
      createdAt: channelIdentities.createdAt,
    })
    .from(channelIdentities)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, channelIdentities.accountId))
    .where(and(eq(channelIdentities.contactId, c.id), eq(channelIdentities.orgId, ctx.orgId)));

  const hasType = (type: string) => sql`coalesce(${messages.attachments}, '[]'::jsonb) @> ${JSON.stringify([{ type }])}::jsonb`;
  const [m] = await db
    .select({
      inbound: sql<number>`count(*) filter (where ${messages.direction} = 'in')::int`,
      outbound: sql<number>`count(*) filter (where ${messages.direction} = 'out')::int`,
      firstIn: sql<string | null>`min(${messages.sentAt}) filter (where ${messages.direction} = 'in')`,
      lastIn: sql<string | null>`max(${messages.sentAt}) filter (where ${messages.direction} = 'in')`,
      storyReplies: sql<number>`count(*) filter (where ${messages.direction} = 'in' and ${hasType("story_reply")})::int`,
      storyMentions: sql<number>`count(*) filter (where ${messages.direction} = 'in' and ${hasType("story_mention")})::int`,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.contactId, c.id), eq(conversations.orgId, ctx.orgId), eq(conversations.channel, "instagram")));

  const [k] = await db
    .select({ count: sql<number>`count(*)::int`, first: sql<string | null>`min(${socialComments.commentedAt})`, last: sql<string | null>`max(${socialComments.commentedAt})` })
    .from(socialComments)
    .where(and(eq(socialComments.orgId, ctx.orgId), eq(socialComments.isOwn, false), c.username ? or(eq(socialComments.contactId, c.id), sql`lower(${socialComments.authorUsername}) = ${c.username.toLowerCase()}`) : eq(socialComments.contactId, c.id)));

  const toDate = (v: string | Date | null | undefined) => (v ? new Date(v) : null);
  const dates = [toDate(m?.firstIn), toDate(k?.first)].filter((d): d is Date => !!d);
  const lasts = [toDate(m?.lastIn), toDate(k?.last)].filter((d): d is Date => !!d);
  const follow = ids.find((i) => i.followsBusiness === true) ?? ids.find((i) => i.followsBusiness === false) ?? ids[0] ?? null;
  const checked = ids.map((i) => i.followCheckedAt).filter((d): d is Date => !!d);
  const lastChecked = checked.length ? new Date(Math.max(...checked.map((d) => d.getTime()))) : null;

  return {
    username: c.username,
    /** O contato tem identidade no Direct (sem isso, a API não deixa consultar se segue). */
    linked: ids.length > 0,
    accountUsername: follow?.accountUsername ?? null,
    followsBusiness: follow?.followsBusiness ?? null,
    followConfirmedSince: follow?.followsBusiness ? follow.followFirstSeenAt : null,
    followCheckedAt: lastChecked,
    followerCount: follow?.followerCount ?? null,
    messages: { inbound: m?.inbound ?? 0, outbound: m?.outbound ?? 0, first: toDate(m?.firstIn), last: toDate(m?.lastIn) },
    storyReplies: m?.storyReplies ?? 0,
    storyMentions: m?.storyMentions ?? 0,
    comments: { count: k?.count ?? 0, first: toDate(k?.first), last: toDate(k?.last) },
    firstInteractionAt: dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null,
    lastInteractionAt: lasts.length ? new Date(Math.max(...lasts.map((d) => d.getTime()))) : null,
    canRefresh: ids.length > 0 && (!lastChecked || Date.now() - lastChecked.getTime() > REFRESH_EVERY_MS),
  };
}

/** Consulta de novo na API (no máximo a cada 10 minutos por contato). */
export async function refreshInstagramRelationship(ctx: Ctx, contactId: string) {
  const c = await visibleContact(ctx, contactId);
  const rows = await db
    .select({ externalId: channelIdentities.externalId, account: connectedAccounts })
    .from(channelIdentities)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, channelIdentities.accountId))
    .where(
      and(
        eq(channelIdentities.contactId, c.id),
        eq(channelIdentities.orgId, ctx.orgId),
        eq(connectedAccounts.status, "connected"),
        or(isNull(channelIdentities.followCheckedAt), sql`${channelIdentities.followCheckedAt} < now() - make_interval(secs => ${REFRESH_EVERY_MS / 1000})`),
        or(isNull(channelIdentities.profileCheckedAt), gt(sql`now()`, sql`${channelIdentities.profileCheckedAt} + make_interval(secs => ${REFRESH_EVERY_MS / 1000})`)),
      ),
    );
  for (const r of rows) {
    await enrichProfile(r.account, c.id, r.externalId).catch((e) => logger.info("Consulta de relacionamento do Instagram falhou", { reason: (e as Error).message }));
  }
  return instagramRelationship(ctx, c.id);
}
