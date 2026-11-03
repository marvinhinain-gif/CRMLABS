/**
 * Rastreio do conteúdo de origem dos cadastros: qual Stories, post do feed ou link da bio trouxe cada resposta.
 * Um "conteúdo rastreado" é um link de origem do formulário (?origem=chave) com o conteúdo do Instagram anexado.
 * A foto é copiada para quiz_assets na hora em que o conteúdo é anexado: a URL do Instagram expira e o Stories some em 24h.
 */
import { and, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { TZDate } from "@date-fns/tz";
import { db } from "../db";
import { instagramStories, quizEvents, quizForms, quizFormVersions, quizSubmissions, socialPosts } from "../db/schema";
import type { Ctx } from "../context";
import { AppError, invalid, notFound } from "../errors";
import { logger } from "../logger";
import { getInstagramApi, ProviderError, type MediaItem } from "../integrations/instagram/client";
import { capabilitiesOf, getActiveAccount, getAccountToken, recordProviderError, type Account } from "../integrations/instagram/accounts";
import { assertForms, assetUrl, getForm, linkUrl, saveDraft, slugify, uploadAsset } from "./quizzes";
import { linkContentSchema } from "@/lib/quiz/schema";
import type { LinkContent, LinkKind, SourceLink } from "@/lib/quiz/types";

export const CONTENT_TYPES = ["feed", "stories"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const TRACKED_KINDS = ["stories", "feed", "bio"] as const;
export type TrackedKind = (typeof TRACKED_KINDS)[number];

export type InstagramContentItem = {
  externalId: string;
  mediaType: string | null;
  caption: string | null;
  permalink: string | null;
  previewUrl: string | null;
  postedAt: string | null;
};
export type InstagramContentList = { connected: boolean; username: string | null; items: InstagramContentItem[]; error?: string };
export type LinkContentWithImage = LinkContent & { imageUrl: string | null };
export type LinkContentView = { key: string; label: string; kind: LinkKind; content: LinkContentWithImage | null };

const withImage = (c: LinkContent): LinkContentWithImage => ({ ...c, imageUrl: c.imageId ? assetUrl(c.imageId) : null });

/** Conteúdo de um link (por chave) já com a URL da foto; null quando o envio não veio de um link. */
export function linkContentFor(links: SourceLink[] | null | undefined, linkKey: string | null | undefined): LinkContentView | null {
  if (!linkKey) return null;
  const l = (links ?? []).find((x) => x.key === linkKey);
  if (!l) return null;
  return { key: l.key, label: l.label, kind: l.kind, content: l.content ? withImage(l.content) : null };
}

const clip = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").trim();
  return t ? t.slice(0, n) : null;
};
const iso = (d: Date | string | null | undefined) => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};
const igPermalink = (u: string | null | undefined) => (u && /^https:\/\/(www\.)?instagram\.com\//.test(u) ? u : null);

// ---------- Lista do Instagram ----------

const FEED_LIMIT = 30;
const toItem = (m: MediaItem): InstagramContentItem => ({
  externalId: m.id,
  mediaType: m.mediaType ?? null,
  caption: clip(m.caption, 500),
  permalink: igPermalink(m.permalink),
  previewUrl: m.thumbnailUrl ?? m.mediaUrl ?? null,
  postedAt: iso(m.timestamp),
});

export async function listInstagramContent(ctx: Ctx, type: ContentType): Promise<InstagramContentList> {
  assertForms(ctx);
  const account = await getActiveAccount(ctx.orgId);
  if (!account) return { connected: false, username: null, items: [] };
  const username = account.username ?? null;
  if (!capabilitiesOf(account).connected) {
    return { connected: false, username, items: [], error: "A conexão com o Instagram precisa ser refeita. Reconecte em Integrações." };
  }
  try {
    if (type === "feed") {
      const rows = await db.select().from(socialPosts).where(and(eq(socialPosts.orgId, ctx.orgId), eq(socialPosts.accountId, account.id))).orderBy(sql`${socialPosts.postedAt} desc nulls last`).limit(FEED_LIMIT);
      if (rows.length) {
        return {
          connected: true,
          username,
          items: rows.map((p) => ({ externalId: p.externalId, mediaType: p.mediaType, caption: clip(p.caption, 500), permalink: igPermalink(p.permalink), previewUrl: p.thumbnailUrl ?? p.mediaUrl ?? null, postedAt: iso(p.postedAt) })),
        };
      }
      if (ctx.org.isDemo) return { connected: true, username, items: [] };
      const media = await getInstagramApi().listMedia(await getAccountToken(account.id), FEED_LIMIT);
      return { connected: true, username, items: media.map(toItem) };
    }
    if (ctx.org.isDemo) return { connected: true, username, items: [] };
    const stories = await getInstagramApi().listStories(await getAccountToken(account.id));
    return { connected: true, username, items: stories.map(toItem) };
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    await recordProviderError(account, e);
    logger.warn("Falha ao listar conteúdo do Instagram", { type, code: e.code, kind: e.kind });
    return { connected: true, username, items: [], error: "Não foi possível buscar seus conteúdos no Instagram agora. Tente novamente em instantes." };
  }
}

// ---------- Foto (cópia guardada) ----------

const IMAGE_MAX = 8 * 1024 * 1024;
const allowedImageUrl = (raw: string) => {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.port && !u.username && !u.password && (u.hostname.endsWith(".cdninstagram.com") || u.hostname.endsWith(".fbcdn.net"));
  } catch {
    return false;
  }
};

export async function downloadImage(url: string): Promise<Buffer> {
  if (!allowedImageUrl(url)) throw new Error("host da imagem não permitido");
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > IMAGE_MAX) throw new Error("imagem grande demais");
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > IMAGE_MAX) throw new Error("imagem grande demais");
  return buf;
}

const GONE = "Esse conteúdo não está mais disponível no Instagram.";

async function findMedia(account: Account, type: ContentType, externalId: string): Promise<MediaItem | null> {
  const api = getInstagramApi();
  const token = await getAccountToken(account.id);
  if (type === "stories") return (await api.listStories(token)).find((m) => m.id === externalId) ?? null;
  try {
    return await api.getMedia(token, externalId);
  } catch (e) {
    // Só "não encontrado/ inválido" usa a cópia local; token vencido, limite ou falha de rede seguem para o tratamento normal.
    if (!(e instanceof ProviderError) || e.kind !== "invalid") throw e;
    logger.warn("Mídia não encontrada no Instagram; usando a cópia local", { code: e.code, kind: e.kind });
    const [p] = await db.select().from(socialPosts).where(and(eq(socialPosts.accountId, account.id), eq(socialPosts.externalId, externalId)));
    if (!p) return null;
    return { id: p.externalId, caption: p.caption ?? undefined, mediaType: p.mediaType ?? undefined, permalink: p.permalink ?? undefined, thumbnailUrl: p.thumbnailUrl ?? undefined, mediaUrl: p.mediaUrl ?? undefined, timestamp: p.postedAt?.toISOString() };
  }
}

async function savedStoryImage(accountId: string, externalId: string) {
  const [r] = await db.select({ imageId: instagramStories.imageId }).from(instagramStories).where(and(eq(instagramStories.accountId, accountId), eq(instagramStories.externalId, externalId)));
  return r?.imageId ?? null;
}

/** Story que já saiu do ar: monta o conteúdo a partir da cópia guardada pelo CRM. */
async function savedStoryContent(accountId: string, orgId: string, externalId: string): Promise<LinkContent | null> {
  const [r] = await db.select().from(instagramStories).where(and(eq(instagramStories.orgId, orgId), eq(instagramStories.accountId, accountId), eq(instagramStories.externalId, externalId)));
  if (!r) return null;
  return { source: "instagram", mediaType: r.mediaType ?? null, externalId: r.externalId, permalink: igPermalink(r.permalink), caption: clip(r.caption, 500), postedAt: iso(r.postedAt), imageId: r.imageId };
}

export const snapshotSchema = z.object({ type: z.enum(CONTENT_TYPES), externalId: z.string().trim().min(1).max(100) });

/** Busca o conteúdo no Instagram (nunca aceita URL do cliente) e guarda a foto. */
export async function snapshotContent(ctx: Ctx, input: z.infer<typeof snapshotSchema>): Promise<LinkContent> {
  assertForms(ctx);
  const account = await getActiveAccount(ctx.orgId);
  if (!account || !capabilitiesOf(account).connected) throw invalid("Conecte o Instagram para escolher um conteúdo.");
  let media: MediaItem | null;
  try {
    media = await findMedia(account, input.type, input.externalId);
    if (!media && input.type === "stories") {
      const savedStory = await savedStoryContent(account.id, ctx.orgId, input.externalId);
      if (savedStory) return savedStory;
    }
  } catch (e) {
    if (!(e instanceof ProviderError)) throw e;
    await recordProviderError(account, e);
    logger.warn("Falha ao buscar conteúdo do Instagram", { type: input.type, code: e.code, kind: e.kind });
    throw new AppError("provider_error", "Não foi possível buscar esse conteúdo no Instagram agora. Tente novamente em instantes.");
  }
  if (!media) throw notFound(GONE);
  // Story já guardado pelo CRM: reaproveita a foto salva em vez de baixar de novo.
  const savedImage = input.type === "stories" ? await savedStoryImage(account.id, media.id) : null;
  const url = savedImage ? null : media.mediaType === "VIDEO" ? (media.thumbnailUrl ?? media.mediaUrl) : (media.mediaUrl ?? media.thumbnailUrl);
  let imageId: string | null = savedImage;
  if (url) {
    try {
      imageId = (await uploadAsset(ctx, await downloadImage(url), "image")).id;
    } catch (e) {
      logger.warn("Foto do conteúdo não foi guardada", e);
    }
  }
  return {
    source: "instagram",
    mediaType: media.mediaType ?? null,
    externalId: media.id,
    permalink: igPermalink(media.permalink),
    caption: clip(media.caption, 500),
    postedAt: iso(media.timestamp),
    imageId,
  };
}

// ---------- Criar o link rastreado ----------

export const addTrackedLinkSchema = z.object({
  kind: z.enum(TRACKED_KINDS),
  label: z.string().trim().min(1, "Dê um nome ao link.").max(80),
  content: linkContentSchema.nullable(),
});

const MAX_LINKS = 40;
const KEY_MAX = 40;

/** Cria o link de origem com o conteúdo e salva pelo mesmo caminho do editor (saveDraft → prepareLinks + auditoria). */
export async function addTrackedLink(ctx: Ctx, formId: string, input: z.infer<typeof addTrackedLinkSchema>) {
  assertForms(ctx);
  const form = await getForm(ctx, formId);
  const existing: SourceLink[] = form.links.map(({ url: _url, ...l }) => l);
  if (existing.length >= MAX_LINKS) throw invalid(`Este formulário já tem ${MAX_LINKS} links de origem. Remova algum para criar outro.`);
  const taken = new Set(existing.map((l) => l.key));
  const base = slugify(input.label).slice(0, KEY_MAX);
  let key = base;
  for (let n = 2; taken.has(key); n++) key = `${base.slice(0, KEY_MAX - String(n).length - 1).replace(/-+$/, "")}-${n}`;
  const link: SourceLink = { key, label: input.label, kind: input.kind, sourceId: null, utmSource: "instagram", utmMedium: input.kind, utmCampaign: null, content: input.content };
  const saved = await saveDraft(ctx, form.id, { links: [...existing, link] });
  const created = saved.links.find((l) => l.key === key);
  if (!created) throw invalid("Não foi possível criar o link.");
  return { link: created, links: saved.links };
}

// ---------- Relatório: cadastros por conteúdo ----------

export const contentReportSchema = z.object({ days: z.enum(["7", "30", "90", "all"]).default("30") });
export type ContentReportPeriod = 7 | 30 | 90 | "all";
export type ContentReportRow = {
  formId: string;
  formName: string;
  key: string;
  label: string;
  kind: LinkKind;
  url: string;
  content: LinkContentWithImage | null;
  views: number;
  starts: number;
  signups: number;
  qualified: number;
  lastSignupAt: string | null;
};
export type ContentReport = {
  days: ContentReportPeriod;
  rows: ContentReportRow[];
  totals: { kind: TrackedKind | "other"; signups: number }[];
  totalSignups: number;
};

/** Início do período no fuso da organização (hoje conta como o 1º dia). */
function periodStart(days: ContentReportPeriod, tz: string): Date | null {
  if (days === "all") return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-").map(Number);
  return new Date(new TZDate(parts[0], parts[1] - 1, parts[2] - (days - 1), 0, 0, 0, tz).getTime());
}

const isTracked = (k: LinkKind): k is TrackedKind => (TRACKED_KINDS as readonly string[]).includes(k);

export async function contentReport(ctx: Ctx, input: { days: ContentReportPeriod }): Promise<ContentReport> {
  assertForms(ctx);
  const since = periodStart(input.days, ctx.org.timezone);
  const forms = await db.select().from(quizForms).where(and(eq(quizForms.orgId, ctx.orgId), ne(quizForms.status, "archived")));
  const ids = forms.map((f) => f.id);
  const totals: ContentReport["totals"] = [...TRACKED_KINDS, "other" as const].map((kind) => ({ kind, signups: 0 }));
  if (!ids.length) return { days: input.days, rows: [], totals, totalSignups: 0 };

  const events = await db
    .select({ formId: quizEvents.formId, key: quizEvents.linkKey, views: sql<number>`count(*) filter (where ${quizEvents.kind} = 'view')::int`, starts: sql<number>`count(*) filter (where ${quizEvents.kind} = 'start')::int` })
    .from(quizEvents)
    .where(and(eq(quizEvents.orgId, ctx.orgId), inArray(quizEvents.formId, ids), sql`${quizEvents.linkKey} is not null`, ...(since ? [gte(quizEvents.createdAt, since)] : [])))
    .groupBy(quizEvents.formId, quizEvents.linkKey);
  const subs = await db
    .select({ formId: quizSubmissions.formId, key: quizSubmissions.linkKey, tierId: quizSubmissions.tierId, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${quizSubmissions.completedAt})` })
    .from(quizSubmissions)
    .where(and(eq(quizSubmissions.orgId, ctx.orgId), inArray(quizSubmissions.formId, ids), isNull(quizSubmissions.duplicateOf), ...(since ? [gte(quizSubmissions.completedAt, since)] : [])))
    .groupBy(quizSubmissions.formId, quizSubmissions.linkKey, quizSubmissions.tierId);

  // Faixas "qualificadas" da versão no ar (senão, do rascunho).
  const liveIds = forms.map((f) => f.liveVersionId).filter((v): v is string => !!v);
  const versions = liveIds.length ? await db.select({ id: quizFormVersions.id, definition: quizFormVersions.definition }).from(quizFormVersions).where(inArray(quizFormVersions.id, liveIds)) : [];
  const qualifiedTiers = new Map(forms.map((f) => [f.id, new Set((versions.find((v) => v.id === f.liveVersionId)?.definition ?? f.draft).scoring.tiers.filter((t) => t.qualified).map((t) => t.id))]));

  const kindOf = new Map(forms.map((f) => [f.id, new Map((f.links ?? []).map((l) => [l.key, l.kind]))]));
  let totalSignups = 0;
  for (const s of subs) {
    totalSignups += s.n;
    const k = s.key ? kindOf.get(s.formId)?.get(s.key) : undefined;
    totals.find((t) => t.kind === (k && isTracked(k) ? k : "other"))!.signups += s.n;
  }

  const rows: ContentReportRow[] = [];
  for (const f of forms) {
    for (const l of f.links ?? []) {
      if (!isTracked(l.kind)) continue;
      const mine = subs.filter((s) => s.formId === f.id && s.key === l.key);
      const ev = events.find((e) => e.formId === f.id && e.key === l.key);
      const last = mine.reduce<Date | null>((a, s) => (s.last && (!a || new Date(s.last) > a) ? new Date(s.last) : a), null);
      rows.push({
        formId: f.id,
        formName: f.name,
        key: l.key,
        label: l.label,
        kind: l.kind,
        url: linkUrl(f.slug, l.key),
        content: l.content ? withImage(l.content) : null,
        views: ev?.views ?? 0,
        starts: ev?.starts ?? 0,
        signups: mine.reduce((a, s) => a + s.n, 0),
        qualified: mine.filter((s) => s.tierId && qualifiedTiers.get(f.id)?.has(s.tierId)).reduce((a, s) => a + s.n, 0),
        lastSignupAt: last ? last.toISOString() : null,
      });
    }
  }
  rows.sort((a, b) => b.signups - a.signups || b.views - a.views);
  return { days: input.days, rows, totals, totalSignups };
}
