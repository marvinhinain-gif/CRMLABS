import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../../db";
import { connectedAccounts, conversations, messages, organizations, socialComments, socialPosts } from "../../db/schema";
import { publish } from "../../realtime";
import { logger } from "../../logger";
import { getInstagramApi, type MediaDetails } from "./client";
import { capabilitiesOf, getAccountToken, recordProviderError, type Account } from "./accounts";
import { autoResolveThreads, enrichProfile, messagePreview, resolveContact } from "./processor";

const g = globalThis as unknown as { __igSyncAt?: Map<string, number>; __igSyncRunning?: Set<string> };
const lastSync = (g.__igSyncAt ??= new Map());
const running = (g.__igSyncRunning ??= new Set());

const isOwnAuthor = (account: Account, id?: string, username?: string) => (!!id && id === account.externalAccountId) || (!!username && !!account.username && username.toLowerCase() === account.username.toLowerCase());

/** Mídia e comentários de uma publicação → banco (sem duplicar; atualiza curtidas e "oculto"). */
export async function upsertMedia(account: Account, m: MediaDetails) {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, account.orgId));
  const values = {
    caption: m.caption ?? null,
    mediaType: m.mediaType ?? null,
    permalink: m.permalink ?? null,
    thumbnailUrl: m.thumbnailUrl ?? (m.mediaType === "VIDEO" ? null : (m.mediaUrl ?? null)),
    mediaUrl: m.mediaUrl ?? null,
    likeCount: m.likeCount ?? null,
    commentsCount: m.commentsCount ?? null,
    postedAt: m.timestamp ? new Date(m.timestamp) : null,
    refreshedAt: new Date(),
  };
  await db
    .insert(socialPosts)
    .values({ orgId: account.orgId, accountId: account.id, externalId: m.id, ...values })
    .onConflictDoUpdate({ target: [socialPosts.accountId, socialPosts.externalId], set: values });
  const [post] = await db.select().from(socialPosts).where(and(eq(socialPosts.accountId, account.id), eq(socialPosts.externalId, m.id)));
  let created = 0;
  for (const c of m.comments ?? []) {
    const own = isOwnAuthor(account, c.fromId, c.username);
    const [existing] = await db.select().from(socialComments).where(and(eq(socialComments.accountId, account.id), eq(socialComments.externalId, c.id)));
    if (existing) {
      await db
        .update(socialComments)
        .set({
          likeCount: c.likeCount ?? existing.likeCount,
          text: c.text ?? existing.text,
          hiddenAt: c.hidden ? (existing.hiddenAt ?? new Date()) : c.hidden === false ? null : existing.hiddenAt,
          postId: existing.postId ?? post.id,
        })
        .where(eq(socialComments.id, existing.id));
      continue;
    }
    let contactId: string | null = null;
    if (c.fromId && !own) {
      contactId = await db.transaction(async (tx) => {
        const r = await resolveContact(tx, account, c.fromId!, { username: c.username, source: "instagram_comment", allowCreate: org.autoCreateFromComments });
        return r.contact ? (r.contact.mergedIntoId ?? r.contact.id) : null;
      });
    }
    const ins = await db
      .insert(socialComments)
      .values({
        orgId: account.orgId,
        accountId: account.id,
        postId: post.id,
        externalId: c.id,
        parentExternalId: c.parentId ?? null,
        authorExternalId: c.fromId ?? null,
        authorUsername: c.username ?? null,
        contactId,
        text: c.text ?? null,
        commentedAt: new Date(c.timestamp),
        isOwn: own,
        likeCount: c.likeCount ?? 0,
        hiddenAt: c.hidden ? new Date() : null,
        status: own ? "done" : "new",
      })
      .onConflictDoNothing()
      .returning({ id: socialComments.id });
    created += ins.length;
  }
  await autoResolveThreads(account.id);
  return { post, created };
}

/** Conversas do Direct pela API oficial (complementa os webhooks; as 20 mensagens mais recentes de cada). */
async function syncConversations(account: Account, token: string) {
  const api = getInstagramApi();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, account.orgId));
  const list = await api.listConversations(token, 25);
  let newMessages = 0;
  const toEnrich: { contactId: string; igsid: string }[] = [];
  for (const c of list) {
    const other = c.participants.find((p) => !isOwnAuthor(account, p.id, p.username));
    if (!other) continue;
    const res = await db.transaction(async (tx) => {
      const { contact, created } = await resolveContact(tx, account, other.id, { username: other.username, source: "instagram_dm", allowCreate: org.autoCreateFromMessages });
      if (!contact) return null;
      const contactId = contact.mergedIntoId ?? contact.id;
      await tx.insert(conversations).values({ orgId: account.orgId, contactId, accountId: account.id, channel: "instagram", ownerId: contact.ownerId, externalThreadId: c.id }).onConflictDoNothing();
      const [conv] = await tx.select().from(conversations).where(and(eq(conversations.orgId, account.orgId), eq(conversations.contactId, contactId), eq(conversations.channel, "instagram")));
      let insertedIn = 0;
      for (const m of c.messages) {
        const out = isOwnAuthor(account, m.fromId, m.fromUsername);
        const ins = await tx
          .insert(messages)
          .values({
            orgId: account.orgId,
            conversationId: conv.id,
            direction: out ? "out" : "in",
            externalId: m.id,
            body: m.text ?? null,
            attachments: m.attachments.length ? m.attachments : null,
            status: out ? "accepted" : "received",
            error: m.unsupported && !m.text && !m.attachments.length ? "Conteúdo não suportado pela API — veja no Instagram." : null,
            sentAt: new Date(m.createdTime),
          })
          .onConflictDoNothing()
          .returning({ id: messages.id });
        if (ins.length) {
          newMessages++;
          // Só conta como não lida o que chegou depois da conexão (o histórico importado não vira pendência artificial).
          if (!out && account.connectedAt && new Date(m.createdTime) > account.connectedAt) insertedIn++;
        }
      }
      // Recalcula o resumo da conversa a partir das mensagens gravadas.
      const [last] = await tx.select().from(messages).where(eq(messages.conversationId, conv.id)).orderBy(desc(messages.sentAt)).limit(1);
      const [lastIn] = await tx.select({ at: messages.sentAt }).from(messages).where(and(eq(messages.conversationId, conv.id), eq(messages.direction, "in"))).orderBy(desc(messages.sentAt)).limit(1);
      if (last) {
        await tx
          .update(conversations)
          .set({
            accountId: account.id,
            externalThreadId: c.id,
            lastMessageAt: last.sentAt,
            lastMessageDirection: last.direction,
            lastMessagePreview: messagePreview(last.body, last.attachments ?? [], !!last.error, last.direction === "out"),
            lastInboundAt: lastIn?.at ?? null,
            unreadCount: sql`${conversations.unreadCount} + ${insertedIn}`,
          })
          .where(eq(conversations.id, conv.id));
      }
      return { contactId, created, convId: conv.id, changed: insertedIn > 0 };
    });
    if (res?.created) toEnrich.push({ contactId: res.contactId, igsid: other.id });
  }
  // Nome e foto oficiais de quem é novo (limitado para poupar a cota da API).
  for (const e of toEnrich.slice(0, 15)) await enrichProfile(account, e.contactId, e.igsid);
  return { conversations: list.length, newMessages };
}

/**
 * Sincroniza a conta pela API oficial: Direct (conversas) e publicações com comentários.
 * Uma execução por vez por conta; chamadas repetidas em menos de `minIntervalMs` são ignoradas.
 */
export async function syncAccount(account: Account, opts: { minIntervalMs?: number; parts?: ("directs" | "comments")[] } = {}) {
  const parts = opts.parts ?? ["directs", "comments"];
  const key = `${account.id}:${parts.join(",")}`;
  if (running.has(account.id)) return { skipped: true as const };
  const [org] = await db.select({ isDemo: organizations.isDemo }).from(organizations).where(eq(organizations.id, account.orgId));
  if (org?.isDemo) return { skipped: true as const }; // demonstração nunca chama a API
  if (opts.minIntervalMs && Date.now() - (lastSync.get(key) ?? 0) < opts.minIntervalMs) return { skipped: true as const };
  const caps = capabilitiesOf(account);
  running.add(account.id);
  lastSync.set(key, Date.now());
  const result = { conversations: 0, newMessages: 0, media: 0, newComments: 0, errors: [] as string[] };
  try {
    const token = await getAccountToken(account.id);
    if (parts.includes("directs") && caps.sendMessages) {
      try {
        Object.assign(result, await syncConversations(account, token));
      } catch (e) {
        await recordProviderError(account, e);
        result.errors.push(`Direct: ${(e as Error).message}`);
      }
    }
    if (parts.includes("comments") && caps.readComments) {
      try {
        const media = await getInstagramApi().listMediaWithComments(token, 12);
        result.media = media.length;
        for (const m of media) result.newComments += (await upsertMedia(account, m)).created;
      } catch (e) {
        await recordProviderError(account, e);
        result.errors.push(`Comentários: ${(e as Error).message}`);
      }
    }
    await db.update(connectedAccounts).set({ lastCheckedAt: new Date() }).where(eq(connectedAccounts.id, account.id));
  } catch (e) {
    await recordProviderError(account, e);
    result.errors.push((e as Error).message);
  } finally {
    running.delete(account.id);
  }
  if (result.newMessages) await publish({ orgId: account.orgId, topic: "conversations" });
  if (result.media) await publish({ orgId: account.orgId, topic: "comments" });
  if (result.errors.length) logger.warn("Sincronização do Instagram com avisos", { errors: result.errors });
  return result;
}

/** Abre a caixa de entrada → atualiza em segundo plano se a última sincronização tiver mais de 2 minutos. */
export function syncSoon(account: Account | null, parts?: ("directs" | "comments")[]) {
  if (!account || account.status !== "connected" || process.env.VITEST === "true") return;
  void syncAccount(account, { minIntervalMs: 120_000, parts }).catch((e) => logger.warn("Falha na sincronização do Instagram", e));
}

/** Processamento em segundo plano: todas as contas conectadas a cada 5 minutos. */
export async function syncAllAccounts() {
  const accounts = await db.select().from(connectedAccounts).where(and(eq(connectedAccounts.provider, "instagram"), eq(connectedAccounts.status, "connected"), ne(connectedAccounts.status, "disconnected"), isNull(connectedAccounts.disconnectedAt)));
  for (const a of accounts) await syncAccount(a, { minIntervalMs: 4 * 60_000 }).catch((e) => logger.warn("Falha na sincronização do Instagram", e));
}

