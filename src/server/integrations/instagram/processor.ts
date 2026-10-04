import { and, eq, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { db, type Tx } from "../../db";
import {
  channelIdentities,
  connectedAccounts,
  contacts,
  conversations,
  messages,
  organizations,
  pipelineStages,
  socialComments,
  socialPosts,
  webhookEvents,
} from "../../db/schema";
import { addToBoard } from "../../services/board";
import { getPipeline, notifyUser } from "../../services/common";
import { publish } from "../../realtime";
import { logger } from "../../logger";
import { getInstagramApi } from "./client";
import { getAccountToken, type Account } from "./accounts";
import { tsz } from "../../time";

type EventRow = typeof webhookEvents.$inferSelect;

async function accountFor(ev: EventRow) {
  if (!ev.orgId || !ev.accountExternalId) return null;
  const [acc] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.orgId, ev.orgId), eq(connectedAccounts.externalAccountId, ev.accountExternalId), ne(connectedAccounts.status, "disconnected")));
  return acc ?? null;
}

export async function processEvent(ev: EventRow) {
  const account = await accountFor(ev);
  if (!account) return; // conta desconectada: evento descartado (não gera registros)
  const data = ev.payload as Record<string, never>;
  switch (ev.field) {
    case "messages":
      return handleMessage(account, data);
    case "message_deleted":
      return handleDeleted(account, data);
    case "read":
      return handleRead(account, data);
    case "comments":
      return handleComment(account, data);
    default:
      return; // evento não suportado: registrado em webhook_events para auditoria
  }
}

/** Resolve o estágio de entrada automática, ignorando etapas arquivadas. */
async function autoEntryStage(orgId: string, tx: Tx) {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org?.autoEntryStageId) return null;
  const rel = await getPipeline(orgId, "relationship", tx);
  const [stage] = await tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.id, org.autoEntryStageId), eq(pipelineStages.pipelineId, rel.id), isNull(pipelineStages.archivedAt)));
  return stage ?? null;
}

/**
 * Encontra ou cria o contato pelo identificador oficial (nunca pelo nome).
 * Seguro contra concorrência: a identidade é única por organização/conta/id externo.
 */
async function resolveContact(
  tx: Tx,
  account: Account,
  externalId: string,
  opts: { username?: string | null; source: "instagram_dm" | "instagram_comment"; allowCreate: boolean },
) {
  const [existing] = await tx
    .select({ contactId: channelIdentities.contactId })
    .from(channelIdentities)
    .where(and(eq(channelIdentities.orgId, account.orgId), eq(channelIdentities.accountId, account.id), eq(channelIdentities.externalId, externalId)));
  if (existing) {
    // Se o contato foi mesclado, segue para o principal.
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, existing.contactId));
    return { contact: c, created: false };
  }
  if (!opts.allowCreate) return { contact: null, created: false };
  const username = opts.username?.replace(/^@/, "").toLowerCase() ?? null;
  const [c] = await tx
    .insert(contacts)
    .values({
      orgId: account.orgId,
      name: username ? `@${username}` : "Contato do Instagram",
      username,
      profileUrl: username ? `https://www.instagram.com/${username}/` : null,
      source: opts.source,
      ownerId: null,
    })
    .returning();
  const inserted = await tx
    .insert(channelIdentities)
    .values({ orgId: account.orgId, contactId: c.id, accountId: account.id, externalId, username })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    // Outro processo criou a identidade ao mesmo tempo: descarta o contato recém-criado.
    await tx.delete(contacts).where(eq(contacts.id, c.id));
    const [again] = await tx
      .select({ contactId: channelIdentities.contactId })
      .from(channelIdentities)
      .where(and(eq(channelIdentities.orgId, account.orgId), eq(channelIdentities.accountId, account.id), eq(channelIdentities.externalId, externalId)));
    const [found] = await tx.select().from(contacts).where(eq(contacts.id, again.contactId));
    return { contact: found, created: false };
  }
  const stage = await autoEntryStage(account.orgId, tx);
  if (stage) await addToBoard({ orgId: account.orgId, userId: null }, c.id, stage.id, tx, opts.source === "instagram_dm" ? "Mensagem recebida" : "Comentário recebido");
  return { contact: c, created: true };
}

/** Busca nome/@ oficiais do remetente (melhor esforço, fora da transação). */
async function enrichProfile(account: Account, contactId: string, igsid: string) {
  try {
    const p = await getInstagramApi().getUserProfile(await getAccountToken(account.id), igsid);
    const username = p.username?.toLowerCase() ?? null;
    await db
      .update(contacts)
      .set({
        name: p.name || (username ? `@${username}` : undefined),
        username: username ?? undefined,
        profileUrl: username ? `https://www.instagram.com/${username}/` : undefined,
        avatarUrl: p.profilePic ?? undefined,
      })
      .where(eq(contacts.id, contactId));
    if (username) await db.update(channelIdentities).set({ username }).where(and(eq(channelIdentities.accountId, account.id), eq(channelIdentities.externalId, igsid)));
  } catch (e) {
    logger.info("Perfil do remetente indisponível pela API", { reason: (e as Error).message });
  }
}

type MessagingEvent = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { mid: string; text?: string; is_echo?: boolean; attachments?: { type: string; payload?: { url?: string } }[] };
};

async function handleMessage(account: Account, ev: MessagingEvent) {
  const msg = ev.message;
  if (!msg?.mid || !ev.sender?.id || !ev.recipient?.id) return;
  const isEcho = !!msg.is_echo || ev.sender.id === account.externalAccountId;
  const userIgsid = isEcho ? ev.recipient.id : ev.sender.id;
  const at = ev.timestamp ? new Date(ev.timestamp) : new Date();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, account.orgId));
  const attachments = (msg.attachments ?? []).map((a) => ({ type: a.type, url: a.payload?.url }));
  const preview = msg.text?.slice(0, 140) ?? (attachments.length ? `[${attachments[0].type}]` : "[mensagem]");

  const result = await db.transaction(async (tx) => {
    const { contact, created } = await resolveContact(tx, account, userIgsid, { source: "instagram_dm", allowCreate: !isEcho ? org.autoCreateFromMessages : false });
    if (!contact) return null;
    const targetId = contact.mergedIntoId ?? contact.id;

    await tx
      .insert(conversations)
      .values({ orgId: account.orgId, contactId: targetId, accountId: account.id, channel: "instagram", ownerId: contact.ownerId })
      .onConflictDoNothing();
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(and(eq(conversations.orgId, account.orgId), eq(conversations.contactId, targetId), eq(conversations.channel, "instagram")));

    if (isEcho && msg.text) {
      // Reconciliação automática: o eco confirma um envio do CRMLABS que ficou sem confirmação.
      const [match] = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, conv.id),
            eq(messages.direction, "out"),
            isNull(messages.externalId),
            inArray(messages.status, ["pending", "unconfirmed"]),
            eq(messages.body, msg.text),
            sql`${messages.createdAt} > now() - interval '15 minutes'`,
          ),
        )
        .limit(1);
      if (match) {
        await tx.update(messages).set({ status: "accepted", externalId: msg.mid, error: null }).where(eq(messages.id, match.id));
        return { conv, contact, created, duplicate: true };
      }
    }
    const inserted = await tx
      .insert(messages)
      .values({
        orgId: account.orgId,
        conversationId: conv.id,
        direction: isEcho ? "out" : "in",
        externalId: msg.mid,
        body: msg.text ?? null,
        attachments: attachments.length ? attachments : null,
        status: isEcho ? "accepted" : "received",
        sentAt: at,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return { conv, contact, created, duplicate: true }; // eco de mensagem enviada pelo CRMLABS

    const isNewest = !conv.lastMessageAt || at >= conv.lastMessageAt;
    await tx
      .update(conversations)
      .set({
        accountId: account.id,
        status: "open",
        lastMessageAt: sql`greatest(${conversations.lastMessageAt}, ${tsz(at)})`,
        ...(isNewest ? { lastMessageDirection: isEcho ? "out" : "in", lastMessagePreview: preview } : {}),
        ...(isEcho ? {} : { lastInboundAt: sql`greatest(${conversations.lastInboundAt}, ${tsz(at)})`, unreadCount: sql`${conversations.unreadCount} + 1` }),
      })
      .where(eq(conversations.id, conv.id));
    await tx.update(contacts).set({ lastInteractionAt: sql`greatest(${contacts.lastInteractionAt}, ${tsz(at)})` }).where(eq(contacts.id, targetId));
    return { conv, contact, created, duplicate: false };
  });
  if (!result || result.duplicate) return;
  if (result.created) await enrichProfile(account, result.contact.id, userIgsid);
  if (!isEcho && result.conv.ownerId) {
    await notifyUser({ orgId: account.orgId, userId: result.conv.ownerId, type: "message.received", title: `Nova mensagem de ${result.contact.name}`, body: preview, link: `/conversas?c=${result.conv.id}` });
  }
  const ownerIds = [result.conv.ownerId, result.contact.ownerId];
  await publish({ orgId: account.orgId, topic: "conversations", entityId: result.conv.id, ownerIds, sharedInbox: !result.conv.ownerId });
  await publish({ orgId: account.orgId, topic: "board", entityId: result.contact.id, ownerIds });
}

async function handleDeleted(account: Account, ev: MessagingEvent) {
  if (!ev.message?.mid) return;
  await db
    .update(messages)
    .set({ body: null, attachments: null, error: "Mensagem apagada pelo remetente" })
    .where(and(eq(messages.orgId, account.orgId), eq(messages.externalId, ev.message.mid)));
  await publish({ orgId: account.orgId, topic: "conversations", managersOnly: false });
}

/** Confirmação de leitura enviada pelo provedor: só então mensagens de saída viram "lidas". */
async function handleRead(account: Account, ev: { sender?: { id: string }; read?: { mid?: string; watermark?: number } }) {
  if (!ev.sender?.id || !ev.read) return;
  const [ident] = await db
    .select()
    .from(channelIdentities)
    .where(and(eq(channelIdentities.accountId, account.id), eq(channelIdentities.externalId, ev.sender.id)));
  if (!ident) return;
  const [conv] = await db.select().from(conversations).where(and(eq(conversations.contactId, ident.contactId), eq(conversations.channel, "instagram")));
  if (!conv) return;
  let until: Date | null = ev.read.watermark ? new Date(ev.read.watermark) : null;
  if (!until && ev.read.mid) {
    const [m] = await db.select().from(messages).where(and(eq(messages.orgId, account.orgId), eq(messages.externalId, ev.read.mid)));
    until = m?.sentAt ?? null;
  }
  if (!until) return;
  await db
    .update(messages)
    .set({ status: "read" })
    .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, "out"), inArray(messages.status, ["accepted", "delivered"]), lte(messages.sentAt, until)));
  await publish({ orgId: account.orgId, topic: "conversations", entityId: conv.id, ownerIds: [conv.ownerId] });
}

type CommentValue = {
  id?: string;
  text?: string;
  parent_id?: string;
  from?: { id: string; username?: string };
  media?: { id: string; media_product_type?: string };
  timestamp?: string | number;
};

async function handleComment(account: Account, v: CommentValue) {
  if (!v.id || !v.media?.id) return;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, account.orgId));
  const isOwn = v.from?.id === account.externalAccountId;
  const at = v.timestamp ? new Date(typeof v.timestamp === "number" ? v.timestamp * 1000 : v.timestamp) : new Date();
  const res = await db.transaction(async (tx) => {
    await tx
      .insert(socialPosts)
      .values({ orgId: account.orgId, accountId: account.id, externalId: v.media!.id, mediaType: v.media!.media_product_type ?? null })
      .onConflictDoNothing();
    const [post] = await tx.select().from(socialPosts).where(and(eq(socialPosts.accountId, account.id), eq(socialPosts.externalId, v.media!.id)));
    let contactId: string | null = null;
    let ownerId: string | null = null;
    let created = false;
    if (v.from?.id && !isOwn) {
      const r = await resolveContact(tx, account, v.from.id, { username: v.from.username, source: "instagram_comment", allowCreate: org.autoCreateFromComments });
      contactId = r.contact ? (r.contact.mergedIntoId ?? r.contact.id) : null;
      ownerId = r.contact?.ownerId ?? null;
      created = r.created;
      if (contactId) await tx.update(contacts).set({ lastInteractionAt: sql`greatest(${contacts.lastInteractionAt}, ${tsz(at)})` }).where(eq(contacts.id, contactId));
    }
    const inserted = await tx
      .insert(socialComments)
      .values({
        orgId: account.orgId,
        accountId: account.id,
        postId: post.id,
        externalId: v.id!,
        parentExternalId: v.parent_id ?? null,
        authorExternalId: v.from?.id ?? null,
        authorUsername: v.from?.username ?? null,
        contactId,
        text: v.text ?? null,
        commentedAt: at,
        isOwn,
        status: isOwn ? "done" : "new",
      })
      .onConflictDoNothing()
      .returning();
    return { inserted: inserted.length > 0, contactId, ownerId, created };
  });
  if (!res.inserted) return;
  await publish({ orgId: account.orgId, topic: "comments", ownerIds: [res.ownerId], sharedInbox: !res.contactId, managersOnly: !res.contactId && !org.sharedInbox });
  if (res.created) await publish({ orgId: account.orgId, topic: "board" });
}
