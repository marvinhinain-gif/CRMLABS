import { and, asc, desc, eq, ilike, inArray, isNull, like, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  auditEvents,
  commentReplies,
  connectedAccounts,
  contacts,
  conversations,
  leads,
  leadSources,
  memberships,
  notes,
  opportunities,
  organizations,
  pipelineStages,
  products,
  relationshipEntries,
  socialComments,
  stageHistory,
  socialPosts,
  users,
} from "../db/schema";
import type { Ctx } from "../context";
import { can, commentScope, contactScope, conversationScope, ROLE_LABEL } from "../permissions";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, cleanText, getPipeline } from "./common";
import { addToBoard, activeEntryFor, isRealLeadSql } from "./board";
import { assertMember } from "./team";
import { countAutoEntries } from "./leadReview";
import { getInstagramApi, ProviderError } from "../integrations/instagram/client";
import { capabilitiesOf, getAccountToken, getActiveAccount, recordProviderError } from "../integrations/instagram/accounts";
import { syncAccount, syncSoon, upsertMedia } from "../integrations/instagram/sync";

const PENDING = ["new", "in_progress"] as const;
const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Comentário "Sem resposta": de terceiros, não excluído nem oculto, ainda não respondido/resolvido. */
const pendingComment = and(eq(socialComments.isOwn, false), isNull(socialComments.deletedAt), isNull(socialComments.hiddenAt), inArray(socialComments.status, [...PENDING]))!;
/** Direct "Sem resposta": a última mensagem é do contato e chegou depois da última resolução manual. */
const pendingConversation = sql`(${conversations.lastMessageDirection} = 'in' and ${conversations.status} = 'open' and (${conversations.resolvedAt} is null or ${conversations.resolvedAt} < ${conversations.lastInboundAt}))`;

// ---------- Conta, contadores ----------
export async function inboxSummary(ctx: Ctx) {
  const account = await getActiveAccount(ctx.orgId);
  const [[d], [c]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(and(conversationScope(ctx), pendingConversation)),
    db.select({ n: sql<number>`count(*)::int` }).from(socialComments).where(and(commentScope(ctx), pendingComment)),
  ]);
  const [synced] = account ? await db.select({ n: sql<number>`count(*)::int` }).from(conversations).where(and(eq(conversations.orgId, ctx.orgId), eq(conversations.accountId, account.id))) : [];
  return {
    account: account ? { username: account.username, status: account.status, capabilities: capabilitiesOf(account), lastCheckedAt: account.lastCheckedAt } : null,
    pendingDirects: d?.n ?? 0,
    pendingComments: c?.n ?? 0,
    /** Importação do histórico do Direct (todas as páginas da API). */
    directSync: account && !ctx.org.isDemo
      ? { done: !!account.dmBackfillDoneAt, startedAt: account.dmBackfillStartedAt, doneAt: account.dmBackfillDoneAt, pages: account.dmBackfillPages, conversations: synced?.n ?? 0 }
      : null,
    /** Cartões que entraram sozinhos no Kanban (regra antiga) aguardando revisão — só administradores. */
    autoLeadsToReview: ctx.role === "admin" ? await countAutoEntries(ctx.orgId) : 0,
  };
}

/** Atualização manual (botão) — qualquer pessoa da equipe; no máximo uma vez a cada 30 s. */
export async function syncNow(ctx: Ctx) {
  const account = await getActiveAccount(ctx.orgId);
  if (!account || account.status !== "connected") throw new AppError("channel_unavailable", "Conecte o Instagram em Configurações para sincronizar.");
  // O botão traz o que é novo e avança um pouco o histórico; o resto continua em segundo plano.
  const r = await syncAccount(account, { minIntervalMs: 30_000, backfillPages: 2 });
  return r;
}

// ---------- Contato do Instagram × Lead comercial ----------
/** Contatos da organização que são a mesma pessoa: mesmo identificador oficial (é o próprio contato) ou mesmo @. */
async function sameUsernameContacts(orgId: string, contactId: string, username: string | null) {
  if (!username) return [] as { id: string; name: string }[];
  return db
    .select({ id: contacts.id, name: contacts.name })
    .from(contacts)
    .where(and(eq(contacts.orgId, orgId), sql`lower(${contacts.username}) = ${username.replace(/^@/, "").toLowerCase()}`, sql`${contacts.id} <> ${contactId}`, isNull(contacts.mergedIntoId), isNull(contacts.archivedAt)))
    .limit(5);
}

async function realLeadState(contactId: string, orgId: string) {
  const [entry, [lead], [opp]] = await Promise.all([
    activeEntryFor(contactId, orgId),
    db.select({ id: leads.id }).from(leads).where(and(eq(leads.contactId, contactId), eq(leads.orgId, orgId))).limit(1),
    db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.contactId, contactId), eq(opportunities.orgId, orgId))).limit(1),
  ]);
  return { entry, isLead: (!!entry && !entry.autoCreated) || !!lead || !!opp };
}

/**
 * Contexto comercial do contato para a conversa. `isLead` só é verdadeiro para Lead de verdade
 * (Transformar em Lead, formulário, oportunidade) — conversar não basta.
 */
export async function leadSummary(ctx: Ctx, contactId: string) {
  const [c] = await db
    .select({ id: contacts.id, name: contacts.name, username: contacts.username, avatarUrl: contacts.avatarUrl, ownerId: contacts.ownerId, lastInteractionAt: contacts.lastInteractionAt, firstSourceId: contacts.firstSourceId, summary: contacts.summary })
    .from(contacts)
    .where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!c) return null;
  const [state, [lead], [opp], [owner], [source]] = await Promise.all([
    realLeadState(c.id, ctx.orgId),
    db.select({ productName: products.name, createdAt: leads.createdAt }).from(leads).leftJoin(products, eq(products.id, leads.productId)).where(and(eq(leads.contactId, c.id), eq(leads.orgId, ctx.orgId))).orderBy(desc(leads.createdAt)).limit(1),
    db
      .select({ id: opportunities.id, status: opportunities.status, product: opportunities.product, stageName: pipelineStages.name, closerName: users.name })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .leftJoin(users, eq(users.id, opportunities.closerId))
      .where(eq(opportunities.contactId, c.id))
      .orderBy(sql`${opportunities.status} = 'open' desc`, desc(opportunities.createdAt))
      .limit(1),
    c.ownerId ? db.select({ name: users.name }).from(users).where(eq(users.id, c.ownerId)) : Promise.resolve([] as { name: string }[]),
    c.firstSourceId ? db.select({ name: leadSources.name, color: leadSources.color }).from(leadSources).where(eq(leadSources.id, c.firstSourceId)) : Promise.resolve([] as { name: string; color: string }[]),
  ]);
  const entry = state.entry;
  const [entryProduct] = entry?.productId ? await db.select({ name: products.name }).from(products).where(eq(products.id, entry.productId)) : [];
  // Mesma pessoa já cadastrada como Lead em outro contato (mesmo @): evita duplicar.
  let duplicateOf: { id: string; name: string } | null = null;
  if (!state.isLead) {
    for (const other of await sameUsernameContacts(ctx.orgId, c.id, c.username)) {
      if ((await realLeadState(other.id, ctx.orgId)).isLead) {
        duplicateOf = other;
        break;
      }
    }
  }
  const ORIGIN: Record<string, string> = { instagram_direct: "Instagram Direct", instagram_comment: "Comentário do Instagram", form: "Formulário", manual: "Cadastro manual" };
  return {
    contact: c,
    isLead: state.isLead,
    /** Cartão que entrou sozinho no Kanban pela regra antiga (aguarda revisão; não é Lead). */
    autoEntry: !!entry && entry.autoCreated,
    duplicateOf,
    origin: source ?? (entry?.origin && ORIGIN[entry.origin] ? { name: ORIGIN[entry.origin], color: "pink" } : null),
    product: entryProduct?.name ?? opp?.product ?? lead?.productName ?? null,
    ownerName: owner?.name ?? null,
    stage: entry && !entry.autoCreated ? { name: entry.stageName, color: entry.stageColor } : null,
    entry: entry && !entry.autoCreated ? { id: entry.id, version: entry.version, stageId: entry.stageId } : null,
    opportunity: opp ? { id: opp.id, status: opp.status, stageName: opp.stageName, closerName: opp.closerName } : null,
    lastContactAt: c.lastInteractionAt,
  };
}

export const transformLeadSchema = z.object({
  from: z.enum(["direct", "comment"]).default("direct"),
  stageId: z.string().uuid().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  productId: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(2000).optional(),
});

/** Opções do formulário "Transformar em Lead": etapas do Social Seller, produtos e etapa sugerida. */
export async function transformLeadOptions(ctx: Ctx) {
  const rel = await getPipeline(ctx.orgId, "relationship");
  const [stages, prods, [org]] = await Promise.all([
    db.select({ id: pipelineStages.id, name: pipelineStages.name, color: pipelineStages.color }).from(pipelineStages).where(and(eq(pipelineStages.pipelineId, rel.id), isNull(pipelineStages.archivedAt))).orderBy(asc(pipelineStages.position)),
    db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))).orderBy(asc(products.name)),
    db.select({ autoEntryStageId: organizations.autoEntryStageId }).from(organizations).where(eq(organizations.id, ctx.orgId)),
  ]);
  const suggested = stages.find((s) => s.id === org?.autoEntryStageId)?.id ?? stages[0]?.id ?? null;
  return { stages, products: prods, defaultStageId: suggested, canAssignOthers: can(ctx, "contacts.assign") };
}

/**
 * "Transformar em Lead": a pessoa só entra no Kanban do Social Seller depois desta confirmação.
 * Sem duplicar: se o contato (ou outro com o mesmo @) já é Lead, recusa e aponta para ele.
 * Um cartão automático antigo do mesmo contato é aproveitado (vira Lead de verdade, na etapa escolhida).
 */
export async function transformToLead(ctx: Ctx, contactId: string, input: z.infer<typeof transformLeadSchema>) {
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!c) throw notFound("Contato não encontrado.");
  const target = c.mergedIntoId ?? c.id;
  if ((await realLeadState(target, ctx.orgId)).isLead) throw new AppError("conflict", "Este contato já é um Lead.", { leadContactId: target });
  for (const other of await sameUsernameContacts(ctx.orgId, target, c.username)) {
    if ((await realLeadState(other.id, ctx.orgId)).isLead) throw new AppError("conflict", `Este contato já é um Lead (${other.name}).`, { leadContactId: other.id });
  }
  const opts = await transformLeadOptions(ctx);
  const stageId = input.stageId ?? opts.defaultStageId;
  const stage = opts.stages.find((s) => s.id === stageId);
  if (!stage) throw invalid("Escolha a etapa inicial do Lead.");
  let ownerId = input.ownerId === undefined ? (c.ownerId ?? ctx.userId) : input.ownerId;
  if (ownerId && ownerId !== ctx.userId) {
    if (!can(ctx, "contacts.assign") && ownerId !== c.ownerId) throw forbidden("Somente gestores e administradores escolhem outro responsável.");
    await assertMember(ctx.orgId, ownerId, { activeOnly: true });
  }
  ownerId ??= null;
  const productId = input.productId && opts.products.some((p) => p.id === input.productId) ? input.productId : null;
  if (input.productId && !productId) throw invalid("Produto inválido.");
  const origin = input.from === "comment" ? "instagram_comment" : "instagram_direct";
  const reason = "Transformado em Lead";

  await db.transaction(async (tx) => {
    const [auto] = await tx
      .select()
      .from(relationshipEntries)
      .where(and(eq(relationshipEntries.contactId, target), eq(relationshipEntries.orgId, ctx.orgId), isNull(relationshipEntries.closedAt)))
      .for("update");
    if (auto) {
      // Cartão automático antigo: vira o Lead (mesma linha, histórico preservado).
      const [from] = await tx.select({ name: pipelineStages.name }).from(pipelineStages).where(eq(pipelineStages.id, auto.stageId));
      await tx
        .update(relationshipEntries)
        .set({ autoCreated: false, origin, productId, createdBy: ctx.userId, stageId: stage.id, version: auto.version + 1, updatedAt: new Date() })
        .where(eq(relationshipEntries.id, auto.id));
      await tx.insert(stageHistory).values({ orgId: ctx.orgId, entityType: "relationship", entityId: auto.id, contactId: target, fromStageId: auto.stageId, fromStageName: from?.name ?? null, toStageId: stage.id, toStageName: stage.name, actorId: ctx.userId, reason });
    } else {
      await addToBoard(ctx, target, stage.id, tx, reason, { origin, productId, createdBy: ctx.userId });
    }
    await tx.update(contacts).set({ ownerId }).where(eq(contacts.id, target));
    // A conversa sem responsável passa para quem cuida do Lead.
    if (ownerId) await tx.update(conversations).set({ ownerId }).where(and(eq(conversations.contactId, target), isNull(conversations.ownerId)));
    if (input.note) await tx.insert(notes).values({ orgId: ctx.orgId, contactId: target, authorId: ctx.userId, body: cleanText(input.note, 2000)! });
  });
  const [owner] = ownerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, ownerId)) : [];
  const productName = productId ? opts.products.find((p) => p.id === productId)?.name : null;
  await audit(db, ctx, "instagram.lead_created", "contact", target, { username: c.username, name: c.name, from: input.from, stage: stage.name, owner: owner?.name ?? null, product: productName ?? null });
  await publish({ orgId: ctx.orgId, topic: "board", entityId: target, ownerIds: [ctx.userId, ownerId, c.ownerId] });
  await publish({ orgId: ctx.orgId, topic: "conversations" });
  await publish({ orgId: ctx.orgId, topic: "comments" });
  return leadSummary(ctx, target);
}

// ---------- Comentários por publicação ----------
export const listPostsSchema = z.object({
  filter: z.enum(["pending", "all"]).default("pending"),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(5).max(60).default(30),
  offset: z.coerce.number().int().min(0).max(5000).default(0),
});

export async function listCommentPosts(ctx: Ctx, f: z.infer<typeof listPostsSchema>) {
  syncSoon(await getActiveAccount(ctx.orgId), ["comments"]);
  const scope = commentScope(ctx);
  const conds: SQL[] = [eq(socialComments.isOwn, false), isNull(socialComments.deletedAt), sql`${socialComments.postId} is not null`, scope];
  if (f.q) {
    const term = `%${f.q.replace(/^@/, "").replace(/[%_]/g, "\\$&")}%`;
    conds.push(or(ilike(socialPosts.caption, term), ilike(socialComments.authorUsername, term), ilike(socialComments.text, term))!);
  }
  const pendingExpr = sql`(${socialComments.hiddenAt} is null and ${socialComments.status} in ('new', 'in_progress'))`;
  const rows = await db
    .select({
      postId: socialPosts.id,
      caption: socialPosts.caption,
      thumbnailUrl: socialPosts.thumbnailUrl,
      mediaType: socialPosts.mediaType,
      permalink: socialPosts.permalink,
      postedAt: socialPosts.postedAt,
      pending: sql<number>`count(*) filter (where ${pendingExpr})::int`,
      total: sql<number>`count(*)::int`,
      lastAt: sql<string>`max(${socialComments.commentedAt})`,
      lastPendingAt: sql<string | null>`max(${socialComments.commentedAt}) filter (where ${pendingExpr})`,
      // Quem comentou: pendentes primeiro (mais recentes), depois os demais.
      authors: sql<string[]>`(array_agg(distinct ${socialComments.authorUsername}) filter (where ${socialComments.authorUsername} is not null and ${pendingExpr}))`,
      allAuthors: sql<string[]>`(array_agg(distinct ${socialComments.authorUsername}) filter (where ${socialComments.authorUsername} is not null))`,
    })
    .from(socialComments)
    .innerJoin(socialPosts, eq(socialPosts.id, socialComments.postId))
    .where(and(...conds))
    .groupBy(socialPosts.id)
    .having(f.filter === "pending" ? sql`count(*) filter (where ${pendingExpr}) > 0` : undefined)
    .orderBy(f.filter === "pending" ? sql`max(${socialComments.commentedAt}) filter (where ${pendingExpr}) desc` : sql`max(${socialComments.commentedAt}) desc`)
    .limit(f.limit + 1)
    .offset(f.offset);
  const page = rows.slice(0, f.limit).map((r) => {
    const list = (f.filter === "pending" ? r.authors : r.allAuthors) ?? [];
    return { ...r, authors: list.slice(0, 3), authorsCount: list.length, allAuthors: undefined };
  });
  const [[sum]] = await Promise.all([db.select({ n: sql<number>`count(*)::int` }).from(socialComments).where(and(scope, pendingComment))]);
  return { rows: page, hasMore: rows.length > f.limit, pendingTotal: sum?.n ?? 0 };
}

async function visiblePost(ctx: Ctx, postId: string) {
  const [p] = await db.select().from(socialPosts).where(and(eq(socialPosts.id, postId), eq(socialPosts.orgId, ctx.orgId)));
  if (!p) throw notFound("Publicação não encontrada.");
  // Quem não vê tudo precisa ter ao menos um comentário visível na publicação.
  if (!can(ctx, "data.all")) {
    const [any] = await db.select({ id: socialComments.id }).from(socialComments).where(and(eq(socialComments.postId, p.id), commentScope(ctx))).limit(1);
    if (!any) throw notFound("Publicação não encontrada.");
  }
  return p;
}

/** Publicação + árvore de comentários (principal → respostas), com o que está pendente e as ações permitidas. */
export async function getPostThread(ctx: Ctx, postId: string) {
  let post = await visiblePost(ctx, postId);
  const [account] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, post.accountId));
  const caps = capabilitiesOf(account);
  // Atualiza mídia (URL expira), curtidas e comentários ao abrir (no máximo a cada 2 minutos).
  if (account && caps.readComments && !ctx.org.isDemo && (!post.refreshedAt || Date.now() - post.refreshedAt.getTime() > 120_000)) {
    try {
      const m = await getInstagramApi().getMedia(await getAccountToken(account.id), post.externalId);
      await upsertMedia(account, m);
      [post] = await db.select().from(socialPosts).where(eq(socialPosts.id, post.id));
    } catch (e) {
      await recordProviderError(account, e);
    }
  }
  const rows = await db
    .select({
      id: socialComments.id,
      externalId: socialComments.externalId,
      parentExternalId: socialComments.parentExternalId,
      authorUsername: socialComments.authorUsername,
      text: socialComments.text,
      commentedAt: socialComments.commentedAt,
      likeCount: socialComments.likeCount,
      isOwn: socialComments.isOwn,
      status: socialComments.status,
      hiddenAt: socialComments.hiddenAt,
      resolvedAt: socialComments.resolvedAt,
      privateReplySentAt: socialComments.privateReplySentAt,
      contactId: socialComments.contactId,
      contactName: contacts.name,
      contactAvatar: contacts.avatarUrl,
      resolvedByName: users.name,
      isLead: sql<boolean>`(${socialComments.contactId} is not null and ${isRealLeadSql(socialComments.contactId)})`,
    })
    .from(socialComments)
    .leftJoin(contacts, eq(contacts.id, socialComments.contactId))
    .leftJoin(users, eq(users.id, socialComments.resolvedBy))
    .where(and(eq(socialComments.postId, post.id), isNull(socialComments.deletedAt)))
    .orderBy(asc(socialComments.commentedAt))
    .limit(500);
  const ids = rows.map((r) => r.id);
  const replies = ids.length
    ? await db
        .select({ commentId: commentReplies.commentId, kind: commentReplies.kind, status: commentReplies.status, error: commentReplies.error, body: commentReplies.body, createdAt: commentReplies.createdAt, sentByName: users.name })
        .from(commentReplies)
        .leftJoin(users, eq(users.id, commentReplies.sentBy))
        .where(inArray(commentReplies.commentId, ids))
    : [];
  const demo = ctx.org.isDemo;
  const shape = (r: (typeof rows)[number]) => {
    const mine = replies.filter((x) => x.commentId === r.id);
    const privateUsed = mine.some((x) => x.kind === "private" && x.status !== "failed") || !!r.privateReplySentAt;
    const within = Date.now() - r.commentedAt.getTime() <= PRIVATE_REPLY_WINDOW_MS;
    const pending = !r.isOwn && !r.hiddenAt && (PENDING as readonly string[]).includes(r.status);
    return {
      ...r,
      pending,
      hidden: !!r.hiddenAt,
      privateReply: mine.find((x) => x.kind === "private") ?? null,
      failedReply: mine.find((x) => x.status === "failed" || x.status === "unconfirmed") ?? null,
      actions: {
        reply: caps.replyComments && !demo,
        privateReply: !r.isOwn && caps.privateReplies && !privateUsed && within && !demo,
        hide: !r.isOwn && caps.replyComments && !demo,
        delete: caps.replyComments && !demo && can(ctx, "data.all"),
        resolve: pending,
      },
    };
  };
  const roots = rows.filter((r) => !r.parentExternalId || !rows.some((x) => x.externalId === r.parentExternalId));
  const thread = roots.map((root) => {
    const children = rows.filter((x) => x.parentExternalId === root.externalId && x.id !== root.id).map(shape);
    const s = shape(root);
    return { ...s, replies: children, threadPending: s.pending || children.some((c) => c.pending) };
  });
  const pendingCount = rows.filter((r) => shape(r).pending).length;
  return {
    post: {
      id: post.id,
      caption: post.caption,
      mediaType: post.mediaType,
      permalink: post.permalink,
      thumbnailUrl: post.thumbnailUrl,
      mediaUrl: post.mediaUrl,
      likeCount: post.likeCount,
      commentsCount: post.commentsCount,
      postedAt: post.postedAt,
    },
    account: { username: account?.username ?? null, canComment: caps.replyComments && !demo },
    thread,
    pendingCount,
    demo,
  };
}

async function visibleComment(ctx: Ctx, id: string) {
  const [c] = await db.select().from(socialComments).where(and(eq(socialComments.id, id), eq(socialComments.orgId, ctx.orgId)));
  if (!c) throw notFound("Comentário não encontrado.");
  if (c.postId) await visiblePost(ctx, c.postId);
  else {
    const [ok] = await db.select({ id: socialComments.id }).from(socialComments).where(and(eq(socialComments.id, id), commentScope(ctx)));
    if (!ok) throw notFound("Comentário não encontrado.");
  }
  return c;
}

async function postCaption(postId: string | null) {
  if (!postId) return null;
  const [p] = await db.select({ caption: socialPosts.caption }).from(socialPosts).where(eq(socialPosts.id, postId));
  return p?.caption?.slice(0, 80) ?? null;
}

export async function resolveComment(ctx: Ctx, id: string, resolved = true) {
  const c = await visibleComment(ctx, id);
  if (c.isOwn) throw invalid("Comentários da própria conta não ficam pendentes.");
  await db
    .update(socialComments)
    .set(resolved ? { status: "done", resolvedAt: new Date(), resolvedBy: ctx.userId } : { status: "new", resolvedAt: null, resolvedBy: null })
    .where(eq(socialComments.id, c.id));
  await audit(db, ctx, resolved ? "instagram.comment_resolved" : "instagram.comment_reopened", "social_comment", c.id, { author: c.authorUsername, postId: c.postId, postCaption: await postCaption(c.postId) });
  await publish({ orgId: ctx.orgId, topic: "comments", entityId: c.id });
}

export async function resolveAllOnPost(ctx: Ctx, postId: string) {
  const post = await visiblePost(ctx, postId);
  const done = await db
    .update(socialComments)
    .set({ status: "done", resolvedAt: new Date(), resolvedBy: ctx.userId })
    .where(and(eq(socialComments.postId, post.id), pendingComment))
    .returning({ id: socialComments.id });
  await audit(db, ctx, "instagram.comments_resolved_all", "social_post", post.id, { count: done.length, postCaption: post.caption?.slice(0, 80) ?? null });
  await publish({ orgId: ctx.orgId, topic: "comments" });
  return { resolved: done.length };
}

async function accountFor(ctx: Ctx, accountId: string) {
  if (ctx.org.isDemo) throw new AppError("channel_unavailable", "Modo demonstração: ações no Instagram estão desativadas.");
  const [account] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, accountId));
  const caps = capabilitiesOf(account);
  if (!account || !caps.replyComments) throw new AppError("channel_unavailable", "A conta do Instagram não permite esta ação agora (conexão ou permissão).");
  return account;
}

export async function hideComment(ctx: Ctx, id: string, hide: boolean) {
  const c = await visibleComment(ctx, id);
  if (c.isOwn) throw invalid("Não é possível ocultar comentários da própria conta.");
  const account = await accountFor(ctx, c.accountId);
  try {
    await getInstagramApi().hideComment(await getAccountToken(account.id), c.externalId, hide);
  } catch (e) {
    await recordProviderError(account, e);
    throw new AppError("provider_error", e instanceof ProviderError ? `O Instagram recusou: ${e.message}` : "Falha ao ocultar.");
  }
  await db.update(socialComments).set({ hiddenAt: hide ? new Date() : null }).where(eq(socialComments.id, c.id));
  await audit(db, ctx, hide ? "instagram.comment_hidden" : "instagram.comment_unhidden", "social_comment", c.id, { author: c.authorUsername, postId: c.postId, postCaption: await postCaption(c.postId), preview: c.text?.slice(0, 120) });
  await publish({ orgId: ctx.orgId, topic: "comments", entityId: c.id });
}

export async function deleteComment(ctx: Ctx, id: string) {
  if (!can(ctx, "data.all")) throw forbidden("Somente administradores e gestores excluem comentários.");
  const c = await visibleComment(ctx, id);
  const account = await accountFor(ctx, c.accountId);
  try {
    await getInstagramApi().deleteComment(await getAccountToken(account.id), c.externalId);
  } catch (e) {
    await recordProviderError(account, e);
    throw new AppError("provider_error", e instanceof ProviderError ? `O Instagram recusou: ${e.message}` : "Falha ao excluir.");
  }
  await db.update(socialComments).set({ deletedAt: new Date() }).where(or(eq(socialComments.id, c.id), and(eq(socialComments.accountId, c.accountId), eq(socialComments.parentExternalId, c.externalId))));
  await audit(db, ctx, "instagram.comment_deleted", "social_comment", c.id, { author: c.authorUsername, postId: c.postId, postCaption: await postCaption(c.postId), preview: c.text?.slice(0, 120) });
  await publish({ orgId: ctx.orgId, topic: "comments", entityId: c.id });
}

export const commentOnPostSchema = z.object({ text: z.string().trim().min(1, "Escreva o comentário.").max(2200) });

/** "Comentar no post como @conta" (POST /{media-id}/comments). */
export async function commentOnPost(ctx: Ctx, postId: string, input: z.infer<typeof commentOnPostSchema>) {
  const post = await visiblePost(ctx, postId);
  const account = await accountFor(ctx, post.accountId);
  const text = cleanText(input.text, 2200)!;
  let externalId: string;
  try {
    externalId = (await getInstagramApi().commentOnMedia(await getAccountToken(account.id), post.externalId, text)).id;
  } catch (e) {
    await recordProviderError(account, e);
    await audit(db, ctx, "instagram.post_commented", "social_post", post.id, { postCaption: post.caption?.slice(0, 80) ?? null, preview: text.slice(0, 120), status: "failed", error: (e as Error).message.slice(0, 200) });
    throw new AppError("provider_error", e instanceof ProviderError ? `O Instagram recusou: ${e.message}` : "Falha ao comentar.");
  }
  await db
    .insert(socialComments)
    .values({ orgId: ctx.orgId, accountId: account.id, postId: post.id, externalId, authorExternalId: account.externalAccountId, authorUsername: account.username, text, commentedAt: new Date(), isOwn: true, status: "done" })
    .onConflictDoNothing();
  await audit(db, ctx, "instagram.post_commented", "social_post", post.id, { postCaption: post.caption?.slice(0, 80) ?? null, preview: text.slice(0, 120), status: "accepted" });
  await publish({ orgId: ctx.orgId, topic: "comments" });
  return { ok: true };
}

// ---------- Histórico (administrador) ----------
export const historySchema = z.object({
  before: z.string().datetime().optional(),
  userId: z.string().uuid().optional(),
  kind: z.enum(["all", "directs", "comments", "leads"]).default("all"),
});

export async function instagramHistory(ctx: Ctx, f: z.infer<typeof historySchema>) {
  if (ctx.role !== "admin") throw forbidden("Somente administradores acessam o histórico do Instagram.");
  const conds: SQL[] = [eq(auditEvents.orgId, ctx.orgId), like(auditEvents.action, "instagram.%")];
  if (f.kind === "directs") conds.push(like(auditEvents.action, "instagram.dm_%"));
  if (f.kind === "comments") conds.push(or(like(auditEvents.action, "instagram.comment%"), like(auditEvents.action, "instagram.post_%"))!);
  if (f.kind === "leads") conds.push(like(auditEvents.action, "instagram.lead%"));
  if (f.userId) conds.push(eq(auditEvents.actorId, f.userId));
  if (f.before) conds.push(lt(auditEvents.createdAt, new Date(f.before)));
  const rows = await db
    .select({ id: auditEvents.id, action: auditEvents.action, entityType: auditEvents.entityType, entityId: auditEvents.entityId, data: auditEvents.data, createdAt: auditEvents.createdAt, actorId: auditEvents.actorId, actorName: users.name, actorRole: memberships.role })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .leftJoin(memberships, and(eq(memberships.userId, auditEvents.actorId), eq(memberships.orgId, auditEvents.orgId)))
    .where(and(...conds))
    .orderBy(desc(auditEvents.createdAt))
    .limit(61);
  // Link "Ver interação": comentário → publicação; Direct → conversa.
  const commentIds = rows.filter((r) => r.entityType === "social_comment" && r.entityId).map((r) => r.entityId!);
  const posts = commentIds.length ? await db.select({ id: socialComments.id, postId: socialComments.postId }).from(socialComments).where(inArray(socialComments.id, commentIds)) : [];
  return {
    rows: rows.slice(0, 60).map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      const postId = r.entityType === "social_post" ? r.entityId : (data.postId as string | undefined) ?? posts.find((p) => p.id === r.entityId)?.postId ?? null;
      const link =
        r.entityType === "conversation"
          ? `/instagram?aba=directs&c=${r.entityId}`
          : postId
            ? `/instagram?aba=comentarios&post=${postId}${r.entityType === "social_comment" ? `&comentario=${r.entityId}` : ""}`
            : r.entityType === "contact"
              ? `?contato=${r.entityId}`
              : null;
      return { ...r, data, roleLabel: r.actorRole ? ROLE_LABEL[r.actorRole] : null, link };
    }),
    nextBefore: rows.length > 60 ? rows[59].createdAt.toISOString() : null,
  };
}

