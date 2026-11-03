/**
 * Conteúdos com mais interação por palavra-chave: posts do feed (curtidas + comentários, buscados no Instagram)
 * e Stories (respostas no Direct, guardadas aqui). Nada é gravado em social_posts.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { instagramStories, quizForms } from "../db/schema";
import type { Ctx } from "../context";
import { logger } from "../logger";
import { getInstagramApi, ProviderError, type MediaDetails } from "../integrations/instagram/client";
import { capabilitiesOf, getActiveAccount, getAccountToken, recordProviderError } from "../integrations/instagram/accounts";
import { assertForms, assetUrl } from "./quizzes";

export const DEFAULT_KEYWORD = "mentoria";
export const topContentSchema = z.object({
  type: z.enum(["feed", "stories"]).default("feed"),
  q: z.string().trim().min(1).max(40).default(DEFAULT_KEYWORD),
  refresh: z.enum(["0", "1"]).optional(),
});

export type TrackedRef = { formId: string; formName: string; key: string; label: string };
export type FeedItem = {
  externalId: string;
  mediaType: string | null;
  caption: string | null;
  permalink: string | null;
  previewUrl: string | null;
  postedAt: string | null;
  likes: number;
  comments: number;
  keywordComments: number;
  matchedIn: ("legenda" | "comentarios")[];
  score: number;
  tracked: TrackedRef[];
};
export type TopFeed = { connected: boolean; username: string | null; error?: string; keyword: string; scanned: number; items: FeedItem[] };
export type StoryItem = {
  id: string;
  externalId: string | null;
  imageUrl: string | null;
  postedAt: string | null;
  replies: number;
  keywordReplies: number;
  samples: string[];
  saved: boolean;
  tracked: TrackedRef[];
};
export type TopStories = { items: StoryItem[]; savedCount: number };

const TOP_LIMIT = 30;
const PAGE = 25;
const MAX_POSTS = 300;
const COMMENTS_PER_POST = 50;
const CACHE_MS = 10 * 60_000;
const STORY_DAYS = 365;

/** Minúsculas e sem acento: "Mentória" casa com "mentoria". */
const fold = (s: string | null | undefined) => (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
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

/** Conteúdos já ligados a algum link de origem (por id do Instagram). */
async function trackedByExternalId(orgId: string): Promise<Map<string, TrackedRef[]>> {
  const forms = await db.select({ id: quizForms.id, name: quizForms.name, links: quizForms.links }).from(quizForms).where(and(eq(quizForms.orgId, orgId), ne(quizForms.status, "archived")));
  const map = new Map<string, TrackedRef[]>();
  for (const f of forms) {
    for (const l of f.links ?? []) {
      const ext = l.content?.externalId;
      if (!ext) continue;
      map.set(ext, [...(map.get(ext) ?? []), { formId: f.id, formName: f.name, key: l.key, label: l.label }]);
    }
  }
  return map;
}

// ---------- Posts do feed ----------

type FeedBase = Omit<FeedItem, "tracked">;
/** Posts brutos por organização + conta: trocar a palavra-chave não chama o Instagram de novo. */
type FeedCache = { at: number; media: MediaDetails[] };
const g = globalThis as unknown as { __igTopFeed?: Map<string, FeedCache> };
const cache = (g.__igTopFeed ??= new Map());

function rank(m: MediaDetails, kw: string): FeedBase | null {
  const inCaption = fold(m.caption).includes(kw);
  const keywordComments = (m.comments ?? []).filter((c) => fold(c.text).includes(kw)).length;
  if (!inCaption && !keywordComments) return null;
  const likes = m.likeCount ?? 0;
  const comments = m.commentsCount ?? m.comments?.length ?? 0;
  return {
    externalId: m.id,
    mediaType: m.mediaType ?? null,
    caption: clip(m.caption, 500),
    permalink: igPermalink(m.permalink),
    previewUrl: m.thumbnailUrl ?? m.mediaUrl ?? null,
    postedAt: iso(m.timestamp),
    likes,
    comments,
    keywordComments,
    matchedIn: [...(inCaption ? (["legenda"] as const) : []), ...(keywordComments ? (["comentarios"] as const) : [])],
    score: likes + comments,
  };
}

export async function topFeed(ctx: Ctx, input: { q: string; refresh?: boolean }): Promise<TopFeed> {
  assertForms(ctx);
  const keyword = input.q.trim();
  const kw = fold(keyword);
  const account = await getActiveAccount(ctx.orgId);
  if (!account) return { connected: false, username: null, keyword, scanned: 0, items: [] };
  const username = account.username ?? null;
  if (!capabilitiesOf(account).connected) {
    return { connected: false, username, keyword, scanned: 0, items: [], error: "A conexão com o Instagram precisa ser refeita. Reconecte em Integrações." };
  }
  if (ctx.org.isDemo) return { connected: true, username, keyword, scanned: 0, items: [] };

  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= CACHE_MS) cache.delete(k);
  const cacheKey = `${ctx.orgId}:${account.id}`;
  let hit: FeedCache | undefined = cache.get(cacheKey);
  if (!hit || input.refresh) {
    try {
      const api = getInstagramApi();
      const token = await getAccountToken(account.id);
      const media: MediaDetails[] = [];
      let after: string | null = null;
      while (media.length < MAX_POSTS) {
        const page = await api.listMediaPage(token, { after, limit: PAGE, commentsLimit: COMMENTS_PER_POST });
        media.push(...page.items);
        if (!page.next || !page.items.length) break;
        after = page.next;
      }
      hit = { at: Date.now(), media: media.slice(0, MAX_POSTS) };
      cache.set(cacheKey, hit);
    } catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      await recordProviderError(account, e);
      logger.warn("Falha ao buscar posts para o ranking de interação", { code: e.code, kind: e.kind });
      return { connected: true, username, keyword, scanned: 0, items: [], error: "Não foi possível buscar seus posts no Instagram agora. Tente novamente em instantes." };
    }
  }
  const found = hit.media.map((m) => rank(m, kw)).filter((r): r is FeedBase => !!r);
  found.sort((a, b) => b.score - a.score || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
  const tracked = await trackedByExternalId(ctx.orgId);
  return { connected: true, username, keyword, scanned: hit.media.length, items: found.slice(0, TOP_LIMIT).map((i) => ({ ...i, tracked: tracked.get(i.externalId) ?? [] })) };
}

// ---------- Stories ----------

/** Tira telefone, e-mail e @usuário do trecho mostrado (privacidade). */
const scrub = (t: string) =>
  t
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "")
    .replace(/@[\w.]+/g, "")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "")
    .replace(/\s+/g, " ")
    .trim();

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const FOLD_FROM = "áàâãäåéèêëíìîïóòôõöúùûüçñ";
const FOLD_TO = "aaaaaaeeeeiiiiooooouuuucn";
const foldSql = (col: ReturnType<typeof sql>) => sql`translate(lower(${col}), ${FOLD_FROM}, ${FOLD_TO})`;

type Group = { gkey: string; hasId: boolean; replies: number; kw: number; firstAt: Date; url: string | null };

export async function topStories(ctx: Ctx, input: { q: string }): Promise<TopStories> {
  assertForms(ctx);
  const kw = fold(input.q.trim());
  const like = `%${escapeLike(kw)}%`;
  const since = new Date(Date.now() - STORY_DAYS * 86_400_000);
  const match = sql`${foldSql(sql`coalesce(m.body, '')`)} like ${like}`;

  // Respostas aos stories, por story (id do Instagram, quando veio pelo webhook) ou pela URL antiga sem parâmetros.
  const grouped = Array.from(
    await db.execute<{ gkey: string; has_id: boolean; replies: number; kw: number; first_at: string | Date; url: string | null }>(sql`
      select coalesce(a->>'storyId', coalesce('asset:' || substring(a->>'url' from '[?&]asset_id=([^&]+)'), regexp_replace(a->>'url', '\\?.*$', ''))) as gkey,
             (a->>'storyId') is not null as has_id,
             count(*)::int as replies,
             (count(*) filter (where ${match}))::int as kw,
             min(m.sent_at) as first_at,
             (array_agg(a->>'url' order by m.sent_at desc))[1] as url
      from messages m
      cross join lateral jsonb_array_elements(m.attachments) a
      where m.org_id = ${ctx.orgId} and m.direction = 'in' and m.attachments is not null and jsonb_typeof(m.attachments) = 'array'
        and a->>'type' = 'story_reply' and m.sent_at >= ${since.toISOString()}::timestamptz
        and coalesce(a->>'storyId', a->>'url') is not null
      group by 1, 2
    `),
  );
  const groups: Group[] = grouped.map((r) => ({ gkey: r.gkey, hasId: r.has_id, replies: r.replies, kw: r.kw, firstAt: new Date(r.first_at), url: r.url }));

  const saved = await db
    .select()
    .from(instagramStories)
    .where(and(eq(instagramStories.orgId, ctx.orgId), sql`coalesce(${instagramStories.postedAt}, ${instagramStories.capturedAt}) >= ${since.toISOString()}::timestamptz`))
    .orderBy(desc(instagramStories.postedAt))
    .limit(500);
  const [{ n: savedCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(instagramStories).where(eq(instagramStories.orgId, ctx.orgId));

  type Cand = StoryItem & { gkey: string; sortAt: number };
  const cands: Cand[] = [];
  const savedIds = new Set(saved.map((s) => s.externalId));
  for (const s of saved) {
    const gr = groups.find((x) => x.hasId && x.gkey === s.externalId);
    const kwReplies = gr?.kw ?? 0;
    if (!kwReplies && !fold(s.caption).includes(kw)) continue;
    const at = s.postedAt ?? s.capturedAt;
    cands.push({ id: s.id, gkey: s.externalId, externalId: s.externalId, imageUrl: s.imageId ? assetUrl(s.imageId) : null, postedAt: iso(at), replies: gr?.replies ?? 0, keywordReplies: kwReplies, samples: [], saved: true, tracked: [], sortAt: at.getTime() });
  }
  for (const gr of groups) {
    if (gr.hasId && savedIds.has(gr.gkey)) continue;
    if (!gr.kw) continue;
    const hash = createHash("sha1").update(gr.gkey).digest("hex").slice(0, 12);
    cands.push({ id: `old:${hash}`, gkey: gr.gkey, externalId: gr.hasId ? gr.gkey : null, imageUrl: gr.url, postedAt: iso(gr.firstAt), replies: gr.replies, keywordReplies: gr.kw, samples: [], saved: false, tracked: [], sortAt: gr.firstAt.getTime() });
  }
  cands.sort((a, b) => b.keywordReplies - a.keywordReplies || b.replies - a.replies || b.sortAt - a.sortAt);
  const top = cands.slice(0, TOP_LIMIT);

  if (top.length) {
    const keys = top.map((c) => c.gkey);
    const rows = Array.from(
      await db.execute<{ gkey: string; body: string }>(sql`
        select gkey, body from (
          select coalesce(a->>'storyId', coalesce('asset:' || substring(a->>'url' from '[?&]asset_id=([^&]+)'), regexp_replace(a->>'url', '\\?.*$', ''))) as gkey, m.body,
                 row_number() over (partition by coalesce(a->>'storyId', coalesce('asset:' || substring(a->>'url' from '[?&]asset_id=([^&]+)'), regexp_replace(a->>'url', '\\?.*$', ''))) order by m.sent_at desc) as rn
          from messages m
          cross join lateral jsonb_array_elements(m.attachments) a
          where m.org_id = ${ctx.orgId} and m.direction = 'in' and m.attachments is not null and jsonb_typeof(m.attachments) = 'array'
            and a->>'type' = 'story_reply' and m.sent_at >= ${since.toISOString()}::timestamptz and ${match}
            and coalesce(a->>'storyId', coalesce('asset:' || substring(a->>'url' from '[?&]asset_id=([^&]+)'), regexp_replace(a->>'url', '\\?.*$', ''))) in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})
        ) x where rn <= 3
      `),
    );
    for (const r of rows) {
      const c = top.find((x) => x.gkey === r.gkey);
      const t = clip(scrub(r.body ?? ""), 120);
      if (c && t && c.samples.length < 3) c.samples.push(t);
    }
  }
  const tracked = await trackedByExternalId(ctx.orgId);
  return { items: top.map(({ gkey: _g, sortAt: _s, ...c }) => ({ ...c, tracked: c.externalId ? (tracked.get(c.externalId) ?? []) : [] })), savedCount };
}
