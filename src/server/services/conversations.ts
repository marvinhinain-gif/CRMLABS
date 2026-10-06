import { and, asc, desc, eq, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { channelIdentities, connectedAccounts, contacts, conversations, messages, savedReplies, users } from "../db/schema";
import type { Ctx } from "../context";
import { assertCan, can, conversationScope } from "../permissions";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, cleanText } from "./common";
import { isRealLeadSql } from "./board";
import { assertMember } from "./team";
import { getInstagramApi, ProviderError } from "../integrations/instagram/client";
import { capabilitiesOf, getAccountToken, recordProviderError, type Account } from "../integrations/instagram/accounts";
import { logger } from "../logger";

export const listConversationsSchema = z.object({
  filter: z.enum(["all", "mine", "unread", "awaiting", "pending", "stories"]).default("all"),
  owner: z.enum(["all", "mine", "none"]).optional(),
  channel: z.enum(["instagram"]).optional(),
  q: z.string().trim().max(100).optional(),
  /** Cursor estável "data|id" (empates de horário não pulam nem repetem conversas). */
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|[0-9a-f-]{36}$/).optional(),
  limit: z.coerce.number().int().min(5).max(50).default(30),
});

export async function listConversations(ctx: Ctx, f: z.infer<typeof listConversationsSchema>) {
  if (f.channel === "instagram" || !f.channel) {
    const { syncSoon } = await import("../integrations/instagram/sync");
    const { getActiveAccount } = await import("../integrations/instagram/accounts");
    syncSoon(await getActiveAccount(ctx.orgId), ["directs"]);
  }
  const conds: SQL[] = [conversationScope(ctx)];
  if (f.filter === "mine") conds.push(eq(conversations.ownerId, ctx.userId));
  if (f.filter === "unread") conds.push(sql`${conversations.unreadCount} > 0`);
  if (f.filter === "awaiting") conds.push(and(eq(conversations.status, "open"), eq(conversations.lastMessageDirection, "in"))!);
  // "Sem resposta": última mensagem do contato, depois da última resolução manual.
  if (f.filter === "pending") conds.push(sql`(${conversations.lastMessageDirection} = 'in' and ${conversations.status} = 'open' and (${conversations.resolvedAt} is null or ${conversations.resolvedAt} < ${conversations.lastInboundAt}))`);
  // Interações com Stories que a API entrega: respostas aos stories da conta e menções em stories.
  if (f.filter === "stories") conds.push(sql`exists (select 1 from messages m where m.conversation_id = ${conversations.id} and (m.attachments @> '[{"type":"story_reply"}]'::jsonb or m.attachments @> '[{"type":"story_mention"}]'::jsonb))`);
  if (f.owner === "mine") conds.push(eq(conversations.ownerId, ctx.userId));
  if (f.owner === "none") conds.push(sql`${conversations.ownerId} is null`);
  if (f.channel) conds.push(eq(conversations.channel, f.channel));
  if (f.q) {
    const raw = f.q.replace(/^@/, "");
    const term = `%${raw.replace(/[%_\\]/g, "\\$&")}%`;
    // Busca no banco (todas as conversas sincronizadas, não só as carregadas na tela):
    // nome, @, identificador oficial do Instagram (IGSID) ou texto das mensagens.
    conds.push(
      or(
        ilike(contacts.name, term),
        ilike(contacts.username, term),
        sql`exists (select 1 from channel_identities ci where ci.contact_id = ${contacts.id} and (ci.external_id = ${raw} or ci.username ilike ${term}))`,
        sql`exists (select 1 from messages m where m.conversation_id = ${conversations.id} and m.body ilike ${term})`,
      )!,
    );
  }
  const sortAt = sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`;
  if (f.cursor) {
    const [at, id] = f.cursor.split("|");
    conds.push(sql`(${sortAt}, ${conversations.id}) < (${at}::timestamptz, ${id}::uuid)`);
  }
  const rows = await db
    .select({
      id: conversations.id,
      sortKey: sql<string>`to_char(${sortAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      channel: conversations.channel,
      status: conversations.status,
      unreadCount: conversations.unreadCount,
      lastMessageAt: conversations.lastMessageAt,
      lastMessagePreview: conversations.lastMessagePreview,
      lastMessageDirection: conversations.lastMessageDirection,
      ownerId: conversations.ownerId,
      ownerName: users.name,
      contactId: contacts.id,
      contactName: contacts.name,
      contactUsername: contacts.username,
      avatarUrl: contacts.avatarUrl,
      accountUsername: connectedAccounts.username,
      resolvedAt: conversations.resolvedAt,
      lastInboundAt: conversations.lastInboundAt,
      // Mensagens recebidas desde a última resposta/resolução (badge da lista).
      pendingCount: sql<number>`(select count(*)::int from messages m where m.conversation_id = ${conversations.id} and m.direction = 'in'
        and m.sent_at > coalesce((select max(o.sent_at) from messages o where o.conversation_id = ${conversations.id} and o.direction = 'out'), '-infinity'::timestamptz)
        and m.sent_at > coalesce(${conversations.resolvedAt}, '-infinity'::timestamptz))`,
      matchedText: f.q
        ? sql<string | null>`(select m.body from messages m where m.conversation_id = ${conversations.id} and m.body ilike ${`%${f.q.replace(/^@/, "").replace(/[%_\\]/g, "\\$&")}%`} order by m.sent_at desc limit 1)`
        : sql<string | null>`null`,
      isLead: isRealLeadSql(contacts.id),
    })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .leftJoin(users, eq(users.id, conversations.ownerId))
    .leftJoin(connectedAccounts, eq(connectedAccounts.id, conversations.accountId))
    .where(and(...conds))
    .orderBy(desc(sortAt), desc(conversations.id))
    .limit(f.limit + 1);
  const hasMore = rows.length > f.limit;
  const page = rows.slice(0, f.limit);
  const last = page[page.length - 1];
  return { rows: page.map(({ sortKey: _s, ...r }) => r), nextCursor: hasMore && last ? `${last.sortKey}|${last.id}` : null };
}

async function getVisibleConversation(ctx: Ctx, id: string) {
  const [row] = await db
    .select({ conv: conversations, contact: contacts })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(conversations.id, id), conversationScope(ctx)));
  if (!row) throw notFound("Conversa não encontrada.");
  return row;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
const HUMAN_AGENT_MS = 7 * 24 * 60 * 60 * 1000;

export type SendEligibility =
  | { allowed: true; humanAgent: boolean; account: Account; recipientId: string; windowEndsAt: Date }
  | { allowed: false; reason: string; code: string };

/**
 * Regras de elegibilidade, sempre avaliadas no servidor:
 * conta conectada com permissão, identidade oficial do contato e janela de resposta do provedor.
 * Um @ cadastrado manualmente não libera envio.
 */
export async function sendEligibility(ctx: Ctx, conv: typeof conversations.$inferSelect): Promise<SendEligibility> {
  if (ctx.org.isDemo) return { allowed: false, code: "demo", reason: "Modo demonstração: o envio externo está desativado." };
  if (!conv.accountId) return { allowed: false, code: "no_account", reason: "Esta conversa não está vinculada a uma conta conectada." };
  const [account] = await db.select().from(connectedAccounts).where(and(eq(connectedAccounts.id, conv.accountId), eq(connectedAccounts.orgId, ctx.orgId)));
  const caps = capabilitiesOf(account);
  if (!account || account.status === "disconnected") return { allowed: false, code: "disconnected", reason: "A conta do Instagram foi desconectada." };
  if (account.status === "reconnect_required") return { allowed: false, code: "reconnect", reason: "Reconexão necessária: peça ao administrador para reconectar o Instagram." };
  if (!caps.sendMessages) return { allowed: false, code: "permission", reason: "A conta não concedeu permissão para mensagens (instagram_business_manage_messages)." };
  const [ident] = await db
    .select()
    .from(channelIdentities)
    .where(and(eq(channelIdentities.contactId, conv.contactId), eq(channelIdentities.accountId, account.id)));
  if (!ident) return { allowed: false, code: "no_identity", reason: "O contato não tem identidade oficial do Instagram (um @ manual não basta)." };
  if (!conv.lastInboundAt) return { allowed: false, code: "no_inbound", reason: "A pessoa ainda não enviou mensagem para esta conta. O Instagram só permite responder conversas iniciadas pelo usuário." };
  const age = Date.now() - conv.lastInboundAt.getTime();
  if (age <= WINDOW_MS) return { allowed: true, humanAgent: false, account, recipientId: ident.externalId, windowEndsAt: new Date(conv.lastInboundAt.getTime() + WINDOW_MS) };
  if (caps.humanAgentTag && age <= HUMAN_AGENT_MS) {
    return { allowed: true, humanAgent: true, account, recipientId: ident.externalId, windowEndsAt: new Date(conv.lastInboundAt.getTime() + HUMAN_AGENT_MS) };
  }
  return { allowed: false, code: "window", reason: "Fora da janela de resposta do Instagram (24 h desde a última mensagem recebida). Aguarde uma nova mensagem do contato." };
}

export const messagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(10).max(100).default(40),
});

export async function getConversation(ctx: Ctx, id: string, q: z.infer<typeof messagesQuerySchema>) {
  const { conv, contact } = await getVisibleConversation(ctx, id);
  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      body: messages.body,
      attachments: messages.attachments,
      status: messages.status,
      error: messages.error,
      sentAt: messages.sentAt,
      sentByName: users.name,
    })
    .from(messages)
    .leftJoin(users, eq(users.id, messages.sentBy))
    .where(and(eq(messages.conversationId, conv.id), q.before ? lt(messages.sentAt, new Date(q.before)) : undefined))
    .orderBy(desc(messages.sentAt))
    .limit(q.limit + 1);
  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit).reverse();
  const elig = await sendEligibility(ctx, conv);
  const [account] = conv.accountId ? await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, conv.accountId)) : [];
  const [owner] = conv.ownerId ? await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, conv.ownerId)) : [];
  return {
    conversation: { ...conv, owner: owner ?? null, accountUsername: account?.username ?? null },
    contact: { id: contact.id, name: contact.name, username: contact.username, avatarUrl: contact.avatarUrl, ownerId: contact.ownerId },
    messages: page,
    hasMore,
    // A API entrega só as 20 mensagens mais recentes de cada conversa; o resto chega pelos webhooks depois da conexão.
    historyNote: hasMore ? null : "Início do histórico disponível. Em conversas antigas, a API do Instagram entrega apenas as 20 mensagens mais recentes.",
    send: elig.allowed ? { allowed: true as const, humanAgent: elig.humanAgent, windowEndsAt: elig.windowEndsAt } : { allowed: false as const, reason: elig.reason, code: elig.code },
  };
}

/** Marcar como lida no CRM é estado interno: não envia confirmação de leitura ao Instagram. */
export async function markRead(ctx: Ctx, id: string) {
  const { conv } = await getVisibleConversation(ctx, id);
  if (conv.unreadCount === 0) return;
  await db.update(conversations).set({ unreadCount: 0 }).where(eq(conversations.id, conv.id));
  await publish({ orgId: ctx.orgId, topic: "conversations", entityId: conv.id, ownerIds: [conv.ownerId] });
  await publish({ orgId: ctx.orgId, topic: "board", ownerIds: [conv.ownerId] });
}

export const updateConversationSchema = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  status: z.enum(["open", "closed"]).optional(),
});

export async function updateConversation(ctx: Ctx, id: string, input: z.infer<typeof updateConversationSchema>) {
  const { conv } = await getVisibleConversation(ctx, id);
  const patch: Partial<typeof conversations.$inferInsert> = {};
  if (input.ownerId !== undefined && input.ownerId !== conv.ownerId) {
    if (!can(ctx, "contacts.assign") && input.ownerId !== ctx.userId) throw forbidden("Somente gestores e administradores redistribuem conversas.");
    if (input.ownerId) await assertMember(ctx.orgId, input.ownerId, { activeOnly: true });
    patch.ownerId = input.ownerId;
  }
  if (input.status) patch.status = input.status;
  if (!Object.keys(patch).length) return conv;
  const [u] = await db.update(conversations).set(patch).where(eq(conversations.id, conv.id)).returning();
  if (patch.ownerId !== undefined) await audit(db, ctx, "conversation.assigned", "conversation", conv.id, { from: conv.ownerId, to: patch.ownerId });
  await publish({ orgId: ctx.orgId, topic: "conversations", entityId: conv.id, ownerIds: [conv.ownerId, u.ownerId], sharedInbox: !u.ownerId });
  return u;
}

/** Resolver / reabrir o atendimento. Uma nova mensagem do contato reabre automaticamente. */
export async function resolveConversation(ctx: Ctx, id: string, resolved: boolean) {
  const { conv, contact } = await getVisibleConversation(ctx, id);
  const [u] = await db
    .update(conversations)
    .set(resolved ? { resolvedAt: new Date(), resolvedBy: ctx.userId, unreadCount: 0 } : { resolvedAt: null, resolvedBy: null })
    .where(eq(conversations.id, conv.id))
    .returning();
  await audit(db, ctx, resolved ? "instagram.dm_resolved" : "instagram.dm_reopened", "conversation", conv.id, { to: contact.username ?? contact.name });
  await publish({ orgId: ctx.orgId, topic: "conversations", entityId: conv.id, ownerIds: [conv.ownerId, contact.ownerId], sharedInbox: !conv.ownerId });
  return u;
}

// ---------- Envio ----------
export const sendSchema = z.object({
  text: z.string().trim().min(1, "Escreva a mensagem.").max(1000, "O Instagram aceita até 1.000 caracteres por mensagem."),
  clientRequestId: z.string().uuid(),
});

/**
 * Envio idempotente: o mesmo clientRequestId nunca gera duas mensagens (clique duplo, retry de rede).
 * Timeout/erro ambíguo → status "unconfirmed": exige reconciliação antes de qualquer reenvio.
 */
export async function sendMessage(ctx: Ctx, conversationId: string, input: z.infer<typeof sendSchema>) {
  const { conv, contact } = await getVisibleConversation(ctx, conversationId);
  const [existing] = await db
    .select()
    .from(messages)
    .where(and(eq(messages.orgId, ctx.orgId), eq(messages.clientRequestId, input.clientRequestId)));
  if (existing) return existing;

  const elig = await sendEligibility(ctx, conv);
  if (!elig.allowed) throw new AppError("channel_unavailable", elig.reason, { code: elig.code });

  const inserted = await db
    .insert(messages)
    .values({
      orgId: ctx.orgId,
      conversationId: conv.id,
      direction: "out",
      body: cleanText(input.text, 1000),
      status: "pending",
      clientRequestId: input.clientRequestId,
      sentBy: ctx.userId,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted.length) {
    const [row] = await db.select().from(messages).where(and(eq(messages.orgId, ctx.orgId), eq(messages.clientRequestId, input.clientRequestId)));
    return row;
  }
  const pending = inserted[0];
  await publish({ orgId: ctx.orgId, topic: "conversations", entityId: conv.id, ownerIds: [conv.ownerId, contact.ownerId] });

  let final: typeof messages.$inferSelect;
  try {
    const r = await getInstagramApi().sendText(await getAccountToken(elig.account.id), elig.recipientId, pending.body!, { humanAgent: elig.humanAgent });
    const at = new Date();
    [final] = await db.update(messages).set({ status: "accepted", externalId: r.messageId, sentAt: at }).where(eq(messages.id, pending.id)).returning();
    await db
      .update(conversations)
      .set({ lastMessageAt: at, lastMessageDirection: "out", lastMessagePreview: pending.body!.slice(0, 140), unreadCount: 0 })
      .where(eq(conversations.id, conv.id));
    await db.update(contacts).set({ lastInteractionAt: at }).where(eq(contacts.id, contact.id));
    const { recordContactMade } = await import("./salesEvents");
    await recordContactMade(ctx, contact.id, db, at);
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("server", "Falha inesperada no envio.");
    await recordProviderError(elig.account, pe);
    const status = pe.ambiguous ? "unconfirmed" : "failed";
    const error = pe.ambiguous
      ? "O Instagram não confirmou o envio a tempo. Verifique antes de reenviar."
      : pe.kind === "window"
        ? "O Instagram recusou: fora da janela de resposta ou destinatário indisponível."
        : pe.kind === "permission"
          ? "Permissão insuficiente para enviar mensagens."
          : pe.kind === "auth"
            ? "Credencial expirada: reconexão necessária."
            : pe.kind === "rate_limit"
              ? "Limite de envio atingido. Tente novamente em alguns minutos."
              : `O Instagram recusou a mensagem: ${pe.message}`.slice(0, 300);
    [final] = await db.update(messages).set({ status, error }).where(eq(messages.id, pending.id)).returning();
    logger.warn(`Envio ${pending.id} terminou como ${status}`, { kind: pe.kind, code: pe.code });
  }
  // Resposta a um story (a última mensagem recebida foi resposta/menção a story): aparece assim no histórico.
  const [lastIn] = await db
    .select({ attachments: messages.attachments })
    .from(messages)
    .where(and(eq(messages.conversationId, conv.id), eq(messages.direction, "in")))
    .orderBy(desc(messages.sentAt))
    .limit(1);
  const story = !!lastIn?.attachments?.some((a) => a.type === "story_reply" || a.type === "story_mention");
  await audit(db, ctx, "instagram.dm_sent", "conversation", conv.id, { to: contact.username ?? contact.name, preview: pending.body?.slice(0, 120), status: final.status, error: final.error, ...(story ? { story: true } : {}) });
  await publish({ orgId: ctx.orgId, topic: "conversations", entityId: conv.id, ownerIds: [conv.ownerId, contact.ownerId] });
  return final;
}

/** Procura a mensagem "não confirmada" no provedor antes de permitir reenvio. */
export async function reconcileMessage(ctx: Ctx, messageId: string) {
  const [m] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.orgId, ctx.orgId)));
  if (!m) throw notFound("Mensagem não encontrada.");
  const { conv } = await getVisibleConversation(ctx, m.conversationId);
  if (m.status !== "unconfirmed") return { status: m.status, found: m.status === "accepted" };
  if (!conv.accountId) throw invalid("Conversa sem conta conectada.");
  const [account] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, conv.accountId));
  const [ident] = await db.select().from(channelIdentities).where(and(eq(channelIdentities.contactId, conv.contactId), eq(channelIdentities.accountId, conv.accountId)));
  if (!account || !ident) throw invalid("Conta ou identidade indisponível para conferir o envio.");
  let found: { id: string } | undefined;
  try {
    const recent = await getInstagramApi().findConversationMessages(await getAccountToken(account.id), ident.externalId);
    const since = m.createdAt.getTime() - 60_000;
    found = recent.find((p) => p.fromId === account.externalAccountId && (p.text ?? "").trim() === (m.body ?? "").trim() && new Date(p.createdTime).getTime() >= since);
  } catch (e) {
    await recordProviderError(account, e);
    throw new AppError("provider_error", "Não foi possível consultar o Instagram agora. Tente conferir novamente em instantes.");
  }
  if (found) {
    const [echo] = await db.select().from(messages).where(and(eq(messages.orgId, ctx.orgId), eq(messages.externalId, found.id)));
    if (echo && echo.id !== m.id) {
      // O eco do Instagram já registrou esta mensagem: mantém um único registro.
      await db.transaction(async (tx) => {
        await tx.delete(messages).where(eq(messages.id, m.id));
        await tx.update(messages).set({ sentBy: m.sentBy, clientRequestId: m.clientRequestId }).where(eq(messages.id, echo.id));
      });
    } else {
      await db.update(messages).set({ status: "accepted", externalId: found.id, error: null }).where(eq(messages.id, m.id));
    }
  } else {
    await db.update(messages).set({ error: "Não encontrada no Instagram. É seguro reenviar." }).where(eq(messages.id, m.id));
  }
  await publish({ orgId: ctx.orgId, topic: "conversations", entityId: conv.id, ownerIds: [conv.ownerId] });
  return { status: found ? "accepted" : "unconfirmed", found: !!found };
}

/** Reenvio explícito: só para mensagens que falharam ou não foram encontradas na reconciliação. */
export async function resendMessage(ctx: Ctx, messageId: string, clientRequestId: string) {
  const [m] = await db.select().from(messages).where(and(eq(messages.id, messageId), eq(messages.orgId, ctx.orgId)));
  if (!m) throw notFound("Mensagem não encontrada.");
  await getVisibleConversation(ctx, m.conversationId);
  if (m.status === "unconfirmed" && !m.error?.includes("seguro reenviar")) {
    throw new AppError("conflict", "Confira o envio no Instagram antes de reenviar (use \"Verificar envio\").");
  }
  if (!["failed", "unconfirmed"].includes(m.status)) throw invalid("Esta mensagem não precisa ser reenviada.");
  await db.update(messages).set({ status: "failed", error: "Reenviada em nova tentativa." }).where(eq(messages.id, m.id));
  return sendMessage(ctx, m.conversationId, { text: m.body ?? "", clientRequestId });
}

/** Conversa interna para um contato (abre a caixa mesmo antes de haver mensagens). */
export async function conversationForContact(ctx: Ctx, contactId: string) {
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .innerJoin(contacts, eq(contacts.id, conversations.contactId))
    .where(and(eq(conversations.contactId, contactId), conversationScope(ctx)));
  return row?.id ?? null;
}

// ---------- Respostas salvas ----------
export async function listSavedReplies(ctx: Ctx) {
  return db.select().from(savedReplies).where(eq(savedReplies.orgId, ctx.orgId)).orderBy(asc(savedReplies.title));
}

export const savedReplySchema = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(1000),
});

export async function createSavedReply(ctx: Ctx, input: z.infer<typeof savedReplySchema>) {
  assertCan(ctx, "savedReplies.manage");
  const [r] = await db.insert(savedReplies).values({ orgId: ctx.orgId, ...input }).returning();
  return r;
}

export async function deleteSavedReply(ctx: Ctx, id: string) {
  assertCan(ctx, "savedReplies.manage");
  await db.delete(savedReplies).where(and(eq(savedReplies.id, id), eq(savedReplies.orgId, ctx.orgId)));
}
