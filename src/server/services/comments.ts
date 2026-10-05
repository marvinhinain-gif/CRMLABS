import { and, desc, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { channelIdentities, commentReplies, connectedAccounts, contacts, socialComments, socialPosts, users } from "../db/schema";
import type { Ctx } from "../context";
import { can, commentScope } from "../permissions";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, cleanText } from "./common";
import { getInstagramApi, ProviderError } from "../integrations/instagram/client";
import { capabilitiesOf, getAccountToken, getActiveAccount, recordProviderError } from "../integrations/instagram/accounts";
import { addToBoard } from "./board";

const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // regra oficial: até 7 dias após o comentário

export const listCommentsSchema = z.object({
  status: z.enum(["new", "in_progress", "replied", "done", "ignored", "all"]).default("all"),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(5).max(50).default(30),
});

export async function listComments(ctx: Ctx, f: z.infer<typeof listCommentsSchema>) {
  const conds: SQL[] = [commentScope(ctx), eq(socialComments.isOwn, false)];
  if (f.status !== "all") conds.push(eq(socialComments.status, f.status));
  if (f.cursor) conds.push(lt(socialComments.commentedAt, new Date(f.cursor)));
  const rows = await db
    .select({
      id: socialComments.id,
      text: socialComments.text,
      authorUsername: socialComments.authorUsername,
      commentedAt: socialComments.commentedAt,
      status: socialComments.status,
      privateReplySentAt: socialComments.privateReplySentAt,
      contactId: socialComments.contactId,
      contactName: contacts.name,
      postCaption: socialPosts.caption,
      postPermalink: socialPosts.permalink,
      postThumbnail: socialPosts.thumbnailUrl,
      postMediaType: socialPosts.mediaType,
      accountId: socialComments.accountId,
      accountUsername: connectedAccounts.username,
      accountStatus: connectedAccounts.status,
      accountScopes: connectedAccounts.grantedScopes,
      accountWebhooks: connectedAccounts.webhooksSubscribed,
    })
    .from(socialComments)
    .innerJoin(connectedAccounts, eq(connectedAccounts.id, socialComments.accountId))
    .leftJoin(contacts, eq(contacts.id, socialComments.contactId))
    .leftJoin(socialPosts, eq(socialPosts.id, socialComments.postId))
    .where(and(...conds))
    .orderBy(desc(socialComments.commentedAt))
    .limit(f.limit + 1);
  const ids = rows.map((r) => r.id);
  const replies = ids.length
    ? await db
        .select({ commentId: commentReplies.commentId, id: commentReplies.id, kind: commentReplies.kind, body: commentReplies.body, status: commentReplies.status, error: commentReplies.error, createdAt: commentReplies.createdAt, sentByName: users.name })
        .from(commentReplies)
        .leftJoin(users, eq(users.id, commentReplies.sentBy))
        .where(inArray(commentReplies.commentId, ids))
        .orderBy(commentReplies.createdAt)
    : [];
  const hasMore = rows.length > f.limit;
  const page = rows.slice(0, f.limit).map(({ accountStatus, accountScopes, accountWebhooks, ...r }) => {
    const caps = capabilitiesOf({ status: accountStatus, grantedScopes: accountScopes, webhooksSubscribed: accountWebhooks });
    const myReplies = replies.filter((x) => x.commentId === r.id);
    const privateUsed = myReplies.some((x) => x.kind === "private" && x.status !== "failed");
    const withinWindow = Date.now() - r.commentedAt.getTime() <= PRIVATE_REPLY_WINDOW_MS;
    return {
      ...r,
      replies: myReplies,
      actions: {
        publicReply: caps.replyComments && !ctx.org.isDemo,
        privateReply: caps.privateReplies && !privateUsed && withinWindow && !ctx.org.isDemo,
        privateReplyBlockedReason: !caps.privateReplies
          ? "A conta não concedeu as permissões necessárias."
          : privateUsed
            ? "O Instagram permite uma única resposta privada por comentário."
            : !withinWindow
              ? "Respostas privadas só são permitidas até 7 dias após o comentário."
              : null,
      },
    };
  });
  return { rows: page, nextCursor: hasMore ? page[page.length - 1]?.commentedAt.toISOString() : null };
}

async function getVisibleComment(ctx: Ctx, id: string) {
  const [c] = await db.select().from(socialComments).where(and(eq(socialComments.id, id), commentScope(ctx)));
  if (!c) throw notFound("Comentário não encontrado.");
  return c;
}

export const replySchema = z.object({
  kind: z.enum(["public", "private"]),
  text: z.string().trim().min(1, "Escreva a resposta.").max(1000),
  clientRequestId: z.string().uuid(),
});

/** "Responder comentário" (público) e "Enviar resposta privada" são ações separadas e idempotentes. */
export async function replyToComment(ctx: Ctx, commentId: string, input: z.infer<typeof replySchema>) {
  const comment = await getVisibleComment(ctx, commentId);
  const [existing] = await db.select().from(commentReplies).where(and(eq(commentReplies.orgId, ctx.orgId), eq(commentReplies.clientRequestId, input.clientRequestId)));
  if (existing) return existing;
  if (ctx.org.isDemo) throw new AppError("channel_unavailable", "Modo demonstração: o envio externo está desativado.");
  const [account] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, comment.accountId));
  const caps = capabilitiesOf(account);
  if (input.kind === "public" && !caps.replyComments) throw new AppError("channel_unavailable", "A conta não permite responder comentários (permissão ou conexão).");
  if (input.kind === "private") {
    if (!caps.privateReplies) throw new AppError("channel_unavailable", "A conta não concedeu as permissões para respostas privadas.");
    if (Date.now() - comment.commentedAt.getTime() > PRIVATE_REPLY_WINDOW_MS) throw new AppError("channel_unavailable", "Respostas privadas só são permitidas até 7 dias após o comentário.");
  }
  const inserted = await db
    .insert(commentReplies)
    .values({ orgId: ctx.orgId, commentId: comment.id, kind: input.kind, body: cleanText(input.text, 1000)!, status: "pending", clientRequestId: input.clientRequestId, sentBy: ctx.userId })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    if (input.kind === "private") throw new AppError("conflict", "Este comentário já recebeu uma resposta privada.");
    const [row] = await db.select().from(commentReplies).where(and(eq(commentReplies.orgId, ctx.orgId), eq(commentReplies.clientRequestId, input.clientRequestId)));
    return row;
  }
  const pending = inserted[0];
  let final: typeof commentReplies.$inferSelect;
  // O Instagram só aceita respostas no comentário principal: respondendo a uma resposta, vai para o principal com @menção.
  const rootExternalId = comment.parentExternalId ?? comment.externalId;
  let publicText = pending.body;
  if (input.kind === "public" && comment.parentExternalId && comment.authorUsername && !publicText.toLowerCase().startsWith(`@${comment.authorUsername.toLowerCase()}`)) {
    publicText = `@${comment.authorUsername} ${publicText}`;
  }
  try {
    const token = await getAccountToken(account.id);
    const api = getInstagramApi();
    const externalId = input.kind === "public" ? (await api.replyToComment(token, rootExternalId, publicText)).id : (await api.sendPrivateReply(token, comment.externalId, pending.body)).messageId;
    [final] = await db.update(commentReplies).set({ status: "accepted", externalId }).where(eq(commentReplies.id, pending.id)).returning();
    await db
      .update(socialComments)
      .set({ status: "replied", resolvedAt: new Date(), resolvedBy: ctx.userId, ...(input.kind === "private" ? { privateReplySentAt: new Date() } : {}) })
      .where(eq(socialComments.id, comment.id));
    // A resposta pública entra na conversa do post na hora (a sincronização não duplica: mesmo id do Instagram).
    if (input.kind === "public") {
      await db
        .insert(socialComments)
        .values({ orgId: ctx.orgId, accountId: account.id, postId: comment.postId, externalId, parentExternalId: rootExternalId, authorExternalId: account.externalAccountId, authorUsername: account.username, text: publicText, commentedAt: new Date(), isOwn: true, status: "done" })
        .onConflictDoNothing();
    }
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("server", "Falha inesperada.");
    await recordProviderError(account, pe);
    const status = pe.ambiguous ? "unconfirmed" : "failed";
    const error = pe.ambiguous ? "O Instagram não confirmou a resposta a tempo. Confira na publicação antes de tentar de novo." : `O Instagram recusou: ${pe.message}`.slice(0, 300);
    [final] = await db.update(commentReplies).set({ status, error }).where(eq(commentReplies.id, pending.id)).returning();
  }
  const [post] = comment.postId ? await db.select({ caption: socialPosts.caption }).from(socialPosts).where(eq(socialPosts.id, comment.postId)) : [];
  await audit(db, ctx, "instagram.comment_replied", "social_comment", comment.id, {
    author: comment.authorUsername,
    kind: input.kind,
    preview: pending.body.slice(0, 120),
    status: final.status,
    postId: comment.postId,
    postCaption: post?.caption?.slice(0, 80) ?? null,
  });
  await publish({ orgId: ctx.orgId, topic: "comments", entityId: comment.id, sharedInbox: !comment.contactId });
  return final;
}

export const updateCommentSchema = z.object({
  status: z.enum(["new", "in_progress", "replied", "done", "ignored"]).optional(),
});

export async function updateComment(ctx: Ctx, id: string, input: z.infer<typeof updateCommentSchema>) {
  const c = await getVisibleComment(ctx, id);
  if (input.status) await db.update(socialComments).set({ status: input.status }).where(eq(socialComments.id, c.id));
  await publish({ orgId: ctx.orgId, topic: "comments", entityId: c.id });
}

export const linkCommentSchema = z.object({
  contactId: z.string().uuid().optional(),
  createContact: z.boolean().optional(),
  stageId: z.string().uuid().nullish(),
});

/**
 * Associa o autor do comentário a um contato. Ao criar, usa o identificador oficial do autor
 * (não o nome) e evita duplicar quando a identidade já existe.
 */
export async function linkCommentToContact(ctx: Ctx, id: string, input: z.infer<typeof linkCommentSchema>) {
  const c = await getVisibleComment(ctx, id);
  if (!input.contactId && !input.createContact) throw invalid("Escolha um contato ou crie um novo.");
  const result = await db.transaction(async (tx) => {
    let contactId = input.contactId ?? null;
    if (contactId) {
      const [ct] = await tx.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.orgId, ctx.orgId)));
      if (!ct) throw invalid("Contato inválido.");
      if (!can(ctx, "data.all") && ct.ownerId !== ctx.userId) throw forbidden();
    } else {
      if (c.authorExternalId) {
        const [ident] = await tx
          .select()
          .from(channelIdentities)
          .where(and(eq(channelIdentities.orgId, ctx.orgId), eq(channelIdentities.accountId, c.accountId), eq(channelIdentities.externalId, c.authorExternalId)));
        if (ident) contactId = ident.contactId;
      }
      if (!contactId) {
        const username = c.authorUsername?.toLowerCase() ?? null;
        const [ct] = await tx
          .insert(contacts)
          .values({
            orgId: ctx.orgId,
            name: username ? `@${username}` : "Contato do Instagram",
            username,
            profileUrl: username ? `https://www.instagram.com/${username}/` : null,
            source: "instagram_comment",
            ownerId: can(ctx, "contacts.assign") ? null : ctx.userId,
            lastInteractionAt: c.commentedAt,
          })
          .returning();
        contactId = ct.id;
        if (c.authorExternalId) {
          await tx.insert(channelIdentities).values({ orgId: ctx.orgId, contactId, accountId: c.accountId, externalId: c.authorExternalId, username }).onConflictDoNothing();
        }
        if (input.stageId) await addToBoard(ctx, contactId, input.stageId, tx, "Comentário associado");
      }
    }
    // Associa todos os comentários do mesmo autor sem contato.
    if (c.authorExternalId) {
      await tx
        .update(socialComments)
        .set({ contactId })
        .where(and(eq(socialComments.accountId, c.accountId), eq(socialComments.authorExternalId, c.authorExternalId), isNull(socialComments.contactId)));
    }
    await tx.update(socialComments).set({ contactId }).where(eq(socialComments.id, c.id));
    await audit(tx, ctx, "comment.linked", "social_comment", c.id, { contactId });
    return contactId!;
  });
  await publish({ orgId: ctx.orgId, topic: "comments", entityId: c.id });
  await publish({ orgId: ctx.orgId, topic: "board" });
  return { contactId: result };
}

/** Sincroniza mídias recentes e seus comentários pela API (complementa os webhooks). */
export async function syncComments(ctx: Ctx) {
  if (!can(ctx, "data.all")) throw forbidden("Somente administradores e gestores sincronizam comentários.");
  const account = await getActiveAccount(ctx.orgId);
  if (!account || !capabilitiesOf(account).readComments) {
    throw new AppError("channel_unavailable", "Conecte uma conta do Instagram com permissão de comentários para sincronizar.");
  }
  const api = getInstagramApi();
  let media: Awaited<ReturnType<typeof api.listMedia>> = [];
  let newComments = 0;
  try {
    const token = await getAccountToken(account.id);
    media = await api.listMedia(token, 12);
    for (const m of media) {
      await db
        .insert(socialPosts)
        .values({ orgId: ctx.orgId, accountId: account.id, externalId: m.id, caption: m.caption ?? null, mediaType: m.mediaType ?? null, permalink: m.permalink ?? null, thumbnailUrl: m.thumbnailUrl ?? m.mediaUrl ?? null, postedAt: m.timestamp ? new Date(m.timestamp) : null })
        .onConflictDoUpdate({
          target: [socialPosts.accountId, socialPosts.externalId],
          set: { caption: m.caption ?? null, permalink: m.permalink ?? null, thumbnailUrl: m.thumbnailUrl ?? m.mediaUrl ?? null, postedAt: m.timestamp ? new Date(m.timestamp) : null },
        });
      const [post] = await db.select().from(socialPosts).where(and(eq(socialPosts.accountId, account.id), eq(socialPosts.externalId, m.id)));
      const comments = await api.listComments(token, m.id, 50);
      for (const cm of comments) {
        const isOwn = cm.fromId === account.externalAccountId;
        let contactId: string | null = null;
        if (cm.fromId && !isOwn) {
          const [ident] = await db
            .select()
            .from(channelIdentities)
            .where(and(eq(channelIdentities.orgId, ctx.orgId), eq(channelIdentities.accountId, account.id), eq(channelIdentities.externalId, cm.fromId)));
          contactId = ident?.contactId ?? null;
        }
        const ins = await db
          .insert(socialComments)
          .values({ orgId: ctx.orgId, accountId: account.id, postId: post.id, externalId: cm.id, parentExternalId: cm.parentId ?? null, authorExternalId: cm.fromId ?? null, authorUsername: cm.username ?? null, contactId, text: cm.text ?? null, commentedAt: new Date(cm.timestamp), isOwn, status: isOwn ? "done" : "new" })
          .onConflictDoNothing()
          .returning();
        newComments += ins.length;
      }
    }
  } catch (e) {
    await recordProviderError(account, e);
    throw new AppError("provider_error", e instanceof ProviderError ? `Instagram: ${e.message}` : "Falha ao sincronizar comentários.");
  }
  await publish({ orgId: ctx.orgId, topic: "comments" });
  return { media: media.length, newComments };
}

