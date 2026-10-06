/**
 * Adaptador oficial: Instagram API com Instagram Login (graph.instagram.com).
 * Documentação conferida em 04/10/2026 (Graph API v25.0):
 *  - OAuth: https://www.instagram.com/oauth/authorize → POST https://api.instagram.com/oauth/access_token
 *  - Token longo (60 dias): GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token
 *  - Renovação: GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token
 *  - Mensagens: POST /me/messages  { recipient: { id } | { comment_id }, message: { text } }
 *  - Resposta pública a comentário: POST /{comment-id}/replies?message=
 *  - Webhooks: POST /me/subscribed_apps?subscribed_fields=messages,comments
 *  - Conversas: GET /me/conversations?platform=instagram&fields=participants,updated_time,messages{…}&after={cursor}
 *    (paginação por cursor; 20 mensagens mais recentes por conversa; conversas de "Pedidos" inativas há 30 dias não voltam;
 *    a API não informa a pasta — Principal/Geral/Pedidos — de cada conversa)
 *  - Mídias e comentários: GET /me/media?fields=…,comments{…,replies{…}} · GET /{media-id}?fields=…
 *  - Comentar: POST /{media-id}/comments · Ocultar: POST /{comment-id}?hide=true · Excluir: DELETE /{comment-id}
 * Nada aqui faz scraping, iframe ou automação de sessão.
 */
import { instagramConfig } from "../../env";

export type ProviderErrorKind =
  | "auth" // token inválido/expirado → reconexão necessária
  | "permission" // permissão não concedida
  | "window" // fora da janela de resposta / destinatário indisponível
  | "rate_limit"
  | "invalid"
  | "timeout" // resultado desconhecido: exige reconciliação antes de reenviar
  | "network"
  | "server";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
  }
  /** Se o envio pode ter sido aceito apesar do erro (não é seguro reenviar sem reconciliar). */
  get ambiguous() {
    return this.kind === "timeout" || this.kind === "network" || this.kind === "server";
  }
}

export type TokenResult = { accessToken: string; userId?: string; permissions: string[]; expiresIn?: number };
export type MeResult = { id: string; userId: string; username: string; accountType?: string; name?: string; profilePictureUrl?: string };
export type SendResult = { messageId: string; recipientId?: string };
export type ProviderMessage = { id: string; text?: string; createdTime: string; fromId?: string };
export type MediaItem = { id: string; caption?: string; mediaType?: string; permalink?: string; thumbnailUrl?: string; mediaUrl?: string; timestamp?: string };
export type CommentItem = { id: string; text?: string; timestamp: string; username?: string; fromId?: string; parentId?: string; likeCount?: number; hidden?: boolean };
export type Attachment = { type: string; url?: string; previewUrl?: string; title?: string };
export type ConversationMessage = { id: string; createdTime: string; fromId?: string; fromUsername?: string; text?: string; attachments: Attachment[]; unsupported?: boolean };
export type ConversationItem = { id: string; updatedTime?: string; participants: { id: string; username?: string }[]; messages: ConversationMessage[] };
export type ConversationPage = { items: ConversationItem[]; next: string | null };
export type MediaDetails = MediaItem & { likeCount?: number; commentsCount?: number; comments?: CommentItem[] };

export interface InstagramApi {
  exchangeCode(code: string): Promise<TokenResult>;
  longLivedToken(shortToken: string): Promise<TokenResult>;
  refreshToken(token: string): Promise<TokenResult>;
  getMe(token: string): Promise<MeResult>;
  subscribeWebhooks(token: string, fields: string[]): Promise<void>;
  unsubscribeWebhooks(token: string): Promise<void>;
  sendText(token: string, recipientId: string, text: string, opts?: { humanAgent?: boolean }): Promise<SendResult>;
  sendPrivateReply(token: string, commentId: string, text: string): Promise<SendResult>;
  replyToComment(token: string, commentId: string, text: string): Promise<{ id: string }>;
  getUserProfile(token: string, igsid: string): Promise<{ name?: string; username?: string; profilePic?: string }>;
  findConversationMessages(token: string, igsid: string): Promise<ProviderMessage[]>;
  listMedia(token: string, limit: number): Promise<MediaItem[]>;
  listComments(token: string, mediaId: string, limit: number): Promise<CommentItem[]>;
  /** Uma página de conversas (mais recentes primeiro). `after` = cursor da página anterior. */
  listConversations(token: string, opts: { limit: number; after?: string | null; messages?: number }): Promise<ConversationPage>;
  listMediaWithComments(token: string, limit: number): Promise<MediaDetails[]>;
  getMedia(token: string, mediaId: string): Promise<MediaDetails>;
  commentOnMedia(token: string, mediaId: string, text: string): Promise<{ id: string }>;
  hideComment(token: string, commentId: string, hide: boolean): Promise<void>;
  deleteComment(token: string, commentId: string): Promise<void>;
}

type RawComment = { id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username?: string }; parent_id?: string; like_count?: number; hidden?: boolean; replies?: { data?: RawComment[] } };
const COMMENT_FIELDS = "id,text,timestamp,username,from,parent_id,like_count,hidden";
function flattenComments(list: RawComment[] | undefined): CommentItem[] {
  const out: CommentItem[] = [];
  for (const c of list ?? []) {
    out.push({ id: c.id, text: c.text, timestamp: c.timestamp, username: c.username ?? c.from?.username, fromId: c.from?.id, parentId: c.parent_id, likeCount: c.like_count, hidden: c.hidden });
    for (const r of c.replies?.data ?? []) out.push({ id: r.id, text: r.text, timestamp: r.timestamp, username: r.username ?? r.from?.username, fromId: r.from?.id, parentId: r.parent_id ?? c.id, likeCount: r.like_count, hidden: r.hidden });
  }
  return out;
}

/** Converte anexos da API de mensagens (imagem, vídeo, áudio, arquivo, compartilhamento, story). */
export function parseMessageAttachments(m: Record<string, unknown>): Attachment[] {
  const out: Attachment[] = [];
  const atts = (m.attachments as { data?: Record<string, unknown>[] } | undefined)?.data ?? [];
  for (const a of atts) {
    const img = a.image_data as { url?: string; preview_url?: string } | undefined;
    const vid = a.video_data as { url?: string; preview_url?: string } | undefined;
    const mime = String(a.mime_type ?? "");
    if (img) out.push({ type: "image", url: img.url, previewUrl: img.preview_url });
    else if (vid) out.push({ type: "video", url: vid.url, previewUrl: vid.preview_url });
    else if (mime.startsWith("audio")) out.push({ type: "audio", url: a.file_url as string | undefined });
    else if (a.file_url) out.push({ type: "file", url: a.file_url as string, title: a.name as string | undefined });
  }
  for (const sh of (m.shares as { data?: { link?: string; name?: string; template?: unknown }[] } | undefined)?.data ?? []) out.push({ type: "share", url: sh.link, title: sh.name });
  const story = m.story as { mention?: { link?: string }; reply_to?: { link?: string } } | undefined;
  if (story?.reply_to) out.push({ type: "story_reply", url: story.reply_to.link });
  if (story?.mention) out.push({ type: "story_mention", url: story.mention.link });
  return out;
}

const TIMEOUT_MS = 15_000;
const MESSAGE_FIELDS = "id,created_time,from,to,message,attachments,shares,story,is_unsupported";

function classify(status: number, err: { code?: number; error_subcode?: number; message?: string; type?: string } | undefined): ProviderError {
  const code = err?.code;
  const sub = err?.error_subcode;
  const msg = err?.message ?? `HTTP ${status}`;
  if (code === 190 || err?.type === "OAuthException" && status === 401) return new ProviderError("auth", msg, code, sub);
  if (code === 10 || (code !== undefined && code >= 200 && code < 300)) return new ProviderError("permission", msg, code, sub);
  if (code === 4 || code === 17 || code === 32 || code === 613) return new ProviderError("rate_limit", msg, code, sub);
  if (code === 551 || sub === 2534022 || sub === 2018278 || sub === 2018108) return new ProviderError("window", msg, code, sub);
  if (status >= 500) return new ProviderError("server", msg, code, sub);
  return new ProviderError("invalid", msg, code, sub);
}

export class GraphInstagramApi implements InstagramApi {
  private get cfg() {
    return instagramConfig();
  }
  private get graph() {
    return `https://graph.instagram.com/${this.cfg.graphVersion}`;
  }

  private async request<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const headers = new Headers(init.headers);
    // A API do Instagram exige o token no parâmetro access_token (endpoints /access_token e
    // /refresh_access_token não aceitam o cabeçalho Authorization). A URL só existe nesta chamada
    // servidor → Meta por HTTPS e nunca é registrada em log.
    const target = new URL(url);
    if (init.token) target.searchParams.set("access_token", init.token);
    const { token: _token, ...fetchInit } = init;
    let res: Response;
    try {
      res = await fetch(target, { ...fetchInit, headers, signal: controller.signal, cache: "no-store" });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw new ProviderError("timeout", "Tempo de resposta do Instagram esgotado.");
      throw new ProviderError("network", "Falha de rede ao contatar o Instagram.");
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      /* resposta não-JSON */
    }
    if (!res.ok) throw classify(res.status, (body as { error?: Record<string, never> })?.error);
    return body as T;
  }

  async exchangeCode(code: string): Promise<TokenResult> {
    const form = new URLSearchParams({
      client_id: this.cfg.appId,
      client_secret: this.cfg.appSecret,
      grant_type: "authorization_code",
      redirect_uri: this.cfg.redirectUri,
      code,
    });
    const r = await this.request<{ access_token?: string; user_id?: string | number; permissions?: string[] | string; data?: { access_token: string; user_id: string; permissions: string }[] }>(
      "https://api.instagram.com/oauth/access_token",
      { method: "POST", body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );
    const d = r.data?.[0] ?? r;
    const perms = typeof d.permissions === "string" ? d.permissions.split(",") : (d.permissions ?? []);
    if (!d.access_token) throw new ProviderError("invalid", "Resposta de token sem access_token.");
    return { accessToken: d.access_token, userId: d.user_id != null ? String(d.user_id) : undefined, permissions: perms.map((p) => p.trim()).filter(Boolean) };
  }

  async longLivedToken(shortToken: string): Promise<TokenResult> {
    const q = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: this.cfg.appSecret });
    const r = await this.request<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/access_token?${q}`, { token: shortToken });
    return { accessToken: r.access_token, expiresIn: r.expires_in, permissions: [] };
  }

  async refreshToken(token: string): Promise<TokenResult> {
    const r = await this.request<{ access_token: string; expires_in: number }>(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token`, { token });
    return { accessToken: r.access_token, expiresIn: r.expires_in, permissions: [] };
  }

  async getMe(token: string): Promise<MeResult> {
    const r = await this.request<{ id: string; user_id: string; username: string; account_type?: string; name?: string; profile_picture_url?: string }>(
      `${this.graph}/me?fields=id,user_id,username,account_type,name,profile_picture_url`,
      { token },
    );
    return { id: r.id, userId: String(r.user_id ?? r.id), username: r.username, accountType: r.account_type, name: r.name, profilePictureUrl: r.profile_picture_url };
  }

  async subscribeWebhooks(token: string, fields: string[]) {
    const r = await this.request<{ success?: boolean }>(`${this.graph}/me/subscribed_apps?subscribed_fields=${fields.join(",")}`, { method: "POST", token });
    if (r?.success === false) throw new ProviderError("invalid", "A Meta recusou a inscrição de webhooks.");
  }

  async unsubscribeWebhooks(token: string) {
    await this.request(`${this.graph}/me/subscribed_apps`, { method: "DELETE", token });
  }

  async sendText(token: string, recipientId: string, text: string, opts: { humanAgent?: boolean } = {}): Promise<SendResult> {
    const body: Record<string, unknown> = { recipient: { id: recipientId }, message: { text } };
    if (opts.humanAgent) Object.assign(body, { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
    const r = await this.request<{ message_id: string; recipient_id?: string }>(`${this.graph}/me/messages`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
    return { messageId: r.message_id, recipientId: r.recipient_id };
  }

  async sendPrivateReply(token: string, commentId: string, text: string): Promise<SendResult> {
    const r = await this.request<{ message_id: string; recipient_id?: string }>(`${this.graph}/me/messages`, {
      method: "POST",
      token,
      body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text } }),
      headers: { "Content-Type": "application/json" },
    });
    return { messageId: r.message_id, recipientId: r.recipient_id };
  }

  async replyToComment(token: string, commentId: string, text: string) {
    const form = new URLSearchParams({ message: text });
    return this.request<{ id: string }>(`${this.graph}/${encodeURIComponent(commentId)}/replies`, {
      method: "POST",
      token,
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  async getUserProfile(token: string, igsid: string) {
    const r = await this.request<{ name?: string; username?: string; profile_pic?: string }>(
      `${this.graph}/${encodeURIComponent(igsid)}?fields=name,username,profile_pic`,
      { token },
    );
    return { name: r.name, username: r.username, profilePic: r.profile_pic };
  }

  async findConversationMessages(token: string, igsid: string): Promise<ProviderMessage[]> {
    const conv = await this.request<{ data: { id: string }[] }>(
      `${this.graph}/me/conversations?platform=instagram&user_id=${encodeURIComponent(igsid)}`,
      { token },
    );
    const id = conv.data?.[0]?.id;
    if (!id) return [];
    const r = await this.request<{ messages?: { data: { id: string; message?: string; created_time: string; from?: { id: string } }[] } }>(
      `${this.graph}/${encodeURIComponent(id)}?fields=messages.limit(20){id,message,created_time,from}`,
      { token },
    );
    return (r.messages?.data ?? []).map((m) => ({ id: m.id, text: m.message, createdTime: m.created_time, fromId: m.from?.id }));
  }

  async listMedia(token: string, limit: number): Promise<MediaItem[]> {
    const r = await this.request<{ data: { id: string; caption?: string; media_type?: string; permalink?: string; thumbnail_url?: string; media_url?: string; timestamp?: string }[] }>(
      `${this.graph}/me/media?fields=id,caption,media_type,permalink,thumbnail_url,media_url,timestamp&limit=${limit}`,
      { token },
    );
    return (r.data ?? []).map((m) => ({ id: m.id, caption: m.caption, mediaType: m.media_type, permalink: m.permalink, thumbnailUrl: m.thumbnail_url, mediaUrl: m.media_url, timestamp: m.timestamp }));
  }

  async listComments(token: string, mediaId: string, limit: number): Promise<CommentItem[]> {
    const r = await this.request<{ data: { id: string; text?: string; timestamp: string; username?: string; from?: { id: string; username?: string }; parent_id?: string }[] }>(
      `${this.graph}/${encodeURIComponent(mediaId)}/comments?fields=id,text,timestamp,username,from,parent_id&limit=${limit}`,
      { token },
    );
    return (r.data ?? []).map((c) => ({ id: c.id, text: c.text, timestamp: c.timestamp, username: c.username ?? c.from?.username, fromId: c.from?.id, parentId: c.parent_id }));
  }

  private toConversation(c: { id: string; updated_time?: string; participants?: { data?: { id: string; username?: string }[] }; messages?: { data?: Record<string, unknown>[] } }): ConversationItem {
    return {
      id: c.id,
      updatedTime: c.updated_time,
      participants: c.participants?.data ?? [],
      messages: (c.messages?.data ?? []).map((m) => {
        const from = m.from as { id?: string; username?: string } | undefined;
        return { id: String(m.id), createdTime: String(m.created_time), fromId: from?.id, fromUsername: from?.username, text: (m.message as string) || undefined, attachments: parseMessageAttachments(m), unsupported: !!m.is_unsupported };
      }),
    };
  }

  async listConversations(token: string, opts: { limit: number; after?: string | null; messages?: number }): Promise<ConversationPage> {
    const fields = `participants,updated_time,messages.limit(${Math.min(opts.messages ?? 20, 20)}){${MESSAGE_FIELDS}}`;
    const q = new URLSearchParams({ platform: "instagram", fields, limit: String(opts.limit) });
    if (opts.after) q.set("after", opts.after);
    const r = await this.request<{ data?: Parameters<GraphInstagramApi["toConversation"]>[0][]; paging?: { cursors?: { after?: string }; next?: string } }>(`${this.graph}/me/conversations?${q}`, { token });
    // Paginação por cursor: só existe próxima página quando a API devolve `paging.next`.
    return { items: (r.data ?? []).map((c) => this.toConversation(c)), next: r.paging?.next ? (r.paging.cursors?.after ?? null) : null };
  }

  async listMediaWithComments(token: string, limit: number): Promise<MediaDetails[]> {
    const fields = `id,caption,media_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count,comments.limit(50){${COMMENT_FIELDS},replies{${COMMENT_FIELDS}}}`;
    const r = await this.request<{ data?: (Record<string, unknown> & { comments?: { data?: RawComment[] } })[] }>(`${this.graph}/me/media?fields=${encodeURIComponent(fields)}&limit=${limit}`, { token });
    return (r.data ?? []).map((m) => this.toMedia(m));
  }

  async getMedia(token: string, mediaId: string): Promise<MediaDetails> {
    const fields = `id,caption,media_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count,comments.limit(100){${COMMENT_FIELDS},replies{${COMMENT_FIELDS}}}`;
    const m = await this.request<Record<string, unknown> & { comments?: { data?: RawComment[] } }>(`${this.graph}/${encodeURIComponent(mediaId)}?fields=${encodeURIComponent(fields)}`, { token });
    return this.toMedia(m);
  }

  private toMedia(m: Record<string, unknown> & { comments?: { data?: RawComment[] } }): MediaDetails {
    return {
      id: String(m.id),
      caption: m.caption as string | undefined,
      mediaType: m.media_type as string | undefined,
      permalink: m.permalink as string | undefined,
      thumbnailUrl: m.thumbnail_url as string | undefined,
      mediaUrl: m.media_url as string | undefined,
      timestamp: m.timestamp as string | undefined,
      likeCount: typeof m.like_count === "number" ? m.like_count : undefined,
      commentsCount: typeof m.comments_count === "number" ? m.comments_count : undefined,
      comments: flattenComments(m.comments?.data),
    };
  }

  async commentOnMedia(token: string, mediaId: string, text: string) {
    const form = new URLSearchParams({ message: text });
    return this.request<{ id: string }>(`${this.graph}/${encodeURIComponent(mediaId)}/comments`, { method: "POST", token, body: form, headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  }

  async hideComment(token: string, commentId: string, hide: boolean) {
    await this.request(`${this.graph}/${encodeURIComponent(commentId)}?hide=${hide ? "true" : "false"}`, { method: "POST", token });
  }

  async deleteComment(token: string, commentId: string) {
    await this.request(`${this.graph}/${encodeURIComponent(commentId)}`, { method: "DELETE", token });
  }
}

let api: InstagramApi | null = null;

export function getInstagramApi(): InstagramApi {
  api ??= new GraphInstagramApi();
  return api;
}

/** Usado exclusivamente por testes de contrato. Nunca é ligado automaticamente em falhas. */
export function setInstagramApiForTests(impl: InstagramApi | null) {
  if (process.env.VITEST !== "true") throw new Error("Substituição do adaptador só é permitida em testes");
  api = impl;
}
