/** Conteúdos com mais interação por palavra-chave: stories guardados, respostas no Direct e posts do feed. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/server/db";
import { instagramStories, messages, quizAssets } from "@/server/db/schema";
import { setInstagramApiForTests, type MediaDetails } from "@/server/integrations/instagram/client";
import { handleCallback, startConnect } from "@/server/integrations/instagram/oauth";
import { ingestWebhook, processPendingEvents } from "@/server/integrations/instagram/webhooks";
import { syncAccount } from "@/server/integrations/instagram/sync";
import { createForm, getForm, publishForm } from "@/server/services/quizzes";
import { addTrackedLink, snapshotContent } from "@/server/services/contentTracking";
import { topFeed, topStories } from "@/server/services/topContent";
import { FakeInstagramApi, setupOrg } from "./helpers";

const IG = "17841400000000001";
const IMG = "https://scontent-gru1-1.cdninstagram.com/v/t51/story.jpg";
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const story = (id: string, extra: Record<string, unknown> = {}) => ({ id, mediaType: "IMAGE", permalink: `https://www.instagram.com/stories/x/${id}/`, mediaUrl: IMG, timestamp: iso(60), ...extra });
const post = (id: string, o: { caption?: string; likes?: number; comments?: number; texts?: string[]; mediaType?: string }): MediaDetails => ({
  id,
  caption: o.caption,
  mediaType: o.mediaType ?? "IMAGE",
  permalink: `https://www.instagram.com/p/${id}/`,
  mediaUrl: IMG,
  timestamp: iso(1000),
  likeCount: o.likes ?? 0,
  commentsCount: o.comments ?? 0,
  comments: (o.texts ?? []).map((text, i) => ({ id: `${id}.c${i}`, text, timestamp: iso(10) })),
});

let api: FakeInstagramApi;
let png: Buffer;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  api = new FakeInstagramApi();
  setInstagramApiForTests(api);
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#00f" } }).png().toBuffer();
  globalThis.fetch = vi.fn(async () => new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } })) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function connected(name?: string) {
  const s = await setupOrg(name);
  const url = new URL(await startConnect(s.ctx.admin));
  const account = await handleCallback({ code: "abc", state: url.searchParams.get("state") }, s.ctx.admin);
  const fresh = async () => (await import("@/server/integrations/instagram/accounts")).getActiveAccount(s.org.id);
  return { ...s, account, fresh };
}
const webhookReply = async (n: string, text: string, storyId?: string) => {
  await ingestWebhook(JSON.stringify({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: `igsid-${n}` }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: `mid.${n}`, text, reply_to: { story: { url: `https://cdn.cdninstagram.com/s.jpg?sig=${n}`, id: storyId } } } }] }] }));
  await processPendingEvents();
};
const apiReplies = (rows: { id: string; text: string; url: string }[]) => {
  api.conversations = rows.map((r, i) => ({
    id: `t${i}${r.id}`,
    participants: [{ id: IG, username: "olucaoferraz" }, { id: `igsid-api-${r.id}`, username: `u${r.id}` }],
    messages: [{ id: `api.${r.id}`, createdTime: iso(60 * 24 * 40), fromId: `igsid-api-${r.id}`, text: r.text, attachments: [{ type: "story_reply", url: r.url }] }],
  }));
};

describe("Stories guardados", () => {
  it("a sincronização guarda cada story uma única vez, com a foto", async () => {
    const { account, fresh, org } = await connected();
    api.stories = [story("st1", { caption: "Mentoria aberta" }), story("st2", { mediaType: "VIDEO", mediaUrl: "https://video.cdninstagram.com/v.mp4", thumbnailUrl: IMG })];
    await syncAccount((await fresh())!, { parts: ["stories"] });
    const rows = await db.select().from(instagramStories).where(eq(instagramStories.orgId, org.id));
    expect(rows.map((r) => r.externalId).sort()).toEqual(["st1", "st2"]);
    expect(rows.every((r) => r.imageId && r.accountId === account.id)).toBe(true);
    const [asset] = await db.select().from(quizAssets).where(eq(quizAssets.id, rows[0].imageId!));
    expect(asset.orgId).toBe(org.id);
    const fetchCalls = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(fetchCalls).toBe(2);

    // Segunda execução: nada novo, nada baixado de novo.
    await syncAccount((await fresh())!, { parts: ["stories"] });
    expect(await db.select().from(instagramStories).where(eq(instagramStories.orgId, org.id))).toHaveLength(2);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    // A sincronização padrão também captura stories.
    api.stories = [story("st3")];
    await syncAccount((await fresh())!);
    expect(await db.select().from(instagramStories).where(eq(instagramStories.orgId, org.id))).toHaveLength(3);
  });

  it("falha ao baixar a foto: tenta de novo enquanto o story é recente; perto de expirar guarda sem foto", async () => {
    const { fresh, org } = await connected();
    globalThis.fetch = vi.fn(async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
    api.stories = [story("st1", { timestamp: new Date().toISOString() }), story("st-old", { timestamp: new Date(Date.now() - 21 * 3600_000).toISOString() })];
    await syncAccount((await fresh())!, { parts: ["stories"] });
    const rows = await db.select().from(instagramStories).where(eq(instagramStories.orgId, org.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ externalId: "st-old", imageId: null });
  });

  it("resposta ao story pelo webhook guarda o id do story", async () => {
    const { org } = await connected();
    await webhookReply("a", "quero a mentoria", "story.9");
    const rows = await db.select().from(messages).where(eq(messages.orgId, org.id));
    expect(rows[0].attachments?.[0]).toMatchObject({ type: "story_reply", storyId: "story.9" });
  });

  it("ranking de stories: guardados + respostas antigas, sem acento nem maiúsculas, só da organização", async () => {
    const { ctx, fresh } = await connected();
    api.stories = [story("st1", { caption: "Vem aí" }), story("st2"), story("st3", { caption: "Mentória nova" })];
    await syncAccount((await fresh())!, { parts: ["stories"] });
    await webhookReply("a", "Quero a MENTÓRIA!! meu zap (71) 99999-1111", "st1");
    await webhookReply("b", "mentoria quanto custa?", "st1");
    await webhookReply("c", "lindo", "st1");
    await webhookReply("d", "sem relação", "st2");
    apiReplies([
      { id: "o1", text: "Mentoria é para iniciantes?", url: "https://cdn.cdninstagram.com/old.jpg?sig=1" },
      { id: "o2", text: "Mentoria quando abre?", url: "https://cdn.cdninstagram.com/old.jpg?sig=2" },
      { id: "o3", text: "oi", url: "https://cdn.cdninstagram.com/other.jpg?sig=3" },
      // Links do Direct (lookaside): o story é identificado pelo asset_id da query.
      { id: "o4", text: "mentoria vale a pena?", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=111&signature=a" },
      { id: "o5", text: "quero mentoria", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=111&signature=b" },
      { id: "o6", text: "mentoria top", url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=222&signature=c" },
    ]);
    await syncAccount((await fresh())!, { parts: ["directs"] });

    // Outra organização com resposta que cita a palavra: não pode aparecer.
    const other = await connected("Outra org");
    await webhookReply("z", "mentoria!", "stX");
    void other;

    const r = await topStories(ctx.admin, { q: "mentoria" });
    expect(r.savedCount).toBe(3);
    expect(r.items.map((i) => [i.externalId, i.replies, i.keywordReplies, i.saved])).toEqual([
      ["st1", 3, 2, true],
      [null, 2, 2, false],
      [null, 2, 2, false],
      [null, 1, 1, false],
      ["st3", 0, 0, true], // sem respostas, mas a legenda cita a palavra (Mentória)
    ]);
    const st1 = r.items[0];
    expect(st1.imageUrl).toMatch(/^\/api\/public\/form-assets\//);
    expect(st1.samples).toHaveLength(2);
    expect(st1.samples.join(" ")).not.toMatch(/99999/);
    expect(st1.samples.every((s) => s.length <= 120)).toBe(true);
    const old = r.items.find((i) => i.imageUrl?.includes("cdninstagram.com/old.jpg"))!;
    expect(old).toMatchObject({ replies: 2, keywordReplies: 2, saved: false });
    expect(old.id).toMatch(/^old:/);
    expect(r.items.find((i) => i.imageUrl?.includes("asset_id=111"))).toMatchObject({ replies: 2, keywordReplies: 2 });
    expect(old.postedAt).toBeTruthy();
    // Palavra diferente
    expect((await topStories(ctx.admin, { q: "zzz" })).items).toEqual([]);
    await expect(topStories(ctx.seller, { q: "mentoria" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("snapshot de story que já saiu do ar usa a cópia guardada e marca como rastreado", async () => {
    const { ctx, fresh } = await connected();
    api.stories = [story("st1", { caption: "Mentoria" })];
    await syncAccount((await fresh())!, { parts: ["stories"] });
    const [saved] = await db.select().from(instagramStories);
    api.stories = []; // expirou no Instagram
    const fetchBefore = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const c = await snapshotContent(ctx.admin, { type: "stories", externalId: "st1" });
    expect(c).toMatchObject({ source: "instagram", externalId: "st1", mediaType: "IMAGE", caption: "Mentoria", imageId: saved.imageId });
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchBefore);
    await expect(snapshotContent(ctx.admin, { type: "stories", externalId: "nope" })).rejects.toMatchObject({ code: "not_found" });

    const f = await createForm(ctx.admin, { name: "Aplicação", template: "axion-aplicacao" });
    await publishForm(ctx.admin, f.id);
    await addTrackedLink(ctx.admin, (await getForm(ctx.admin, f.id)).id, { kind: "stories", label: "Story mentoria", content: c });
    const r = await topStories(ctx.admin, { q: "mentoria" });
    expect(r.items[0].tracked).toMatchObject([{ formName: "Aplicação", label: "Story mentoria" }]);
  });
});

describe("Posts do feed com a palavra-chave", () => {
  it("pagina, filtra por legenda/comentários, ordena por curtidas+comentários e marca rastreados", async () => {
    const { ctx } = await connected();
    const many: MediaDetails[] = Array.from({ length: 60 }, (_, i) => post(`p${i}`, { caption: `Post ${i}`, likes: 1, comments: 0 }));
    many[3] = post("cap", { caption: "Minha MENTORIA chegou", likes: 100, comments: 10 });
    many[40] = post("com", { caption: "Sem nada", likes: 300, comments: 20, texts: ["quero mentória", "lindo", "Mentoria?"] });
    many[55] = post("low", { caption: "mentoria hoje", likes: 5, comments: 1, mediaType: "VIDEO" });
    many[57] = post("nope", { caption: "outro", likes: 9999, comments: 99, texts: ["oi"] });
    api.pageMedia = many;
    const r = await topFeed(ctx.admin, { q: "Mentoria" });
    expect(r).toMatchObject({ connected: true, username: "olucaoferraz", keyword: "Mentoria", scanned: 60 });
    expect(r.items.map((i) => i.externalId)).toEqual(["com", "cap", "low"]);
    expect(r.items[0]).toMatchObject({ likes: 300, comments: 20, score: 320, keywordComments: 2, matchedIn: ["comentarios"] });
    expect(r.items[1]).toMatchObject({ score: 110, keywordComments: 0, matchedIn: ["legenda"] });
    expect(api.calls.filter((c) => c.method === "listMediaPage")).toHaveLength(3); // 60 posts / 25 por página

    // Cache de 10 min: mesma palavra não volta ao Instagram; "atualizar" volta.
    await topFeed(ctx.admin, { q: "mentoria" });
    expect(api.calls.filter((c) => c.method === "listMediaPage")).toHaveLength(3);
    await topFeed(ctx.admin, { q: "mentoria", refresh: true });
    expect(api.calls.filter((c) => c.method === "listMediaPage")).toHaveLength(6);

    // Rastreado
    const c = await snapshotContent(ctx.admin, { type: "feed", externalId: "cap" });
    const f = await createForm(ctx.admin, { name: "Aplicação", template: "axion-aplicacao" });
    await addTrackedLink(ctx.admin, f.id, { kind: "feed", label: "Post mentoria", content: c });
    const again = await topFeed(ctx.admin, { q: "mentoria" });
    expect(again.items.find((i) => i.externalId === "cap")!.tracked).toMatchObject([{ formId: f.id, formName: "Aplicação", label: "Post mentoria" }]);
    expect(again.items.find((i) => i.externalId === "com")!.tracked).toEqual([]);
  });

  it("sem conta conectada e sem permissão", async () => {
    const none = await setupOrg("Sem IG");
    expect(await topFeed(none.ctx.admin, { q: "mentoria" })).toEqual({ connected: false, username: null, keyword: "mentoria", scanned: 0, items: [] });
    await expect(topFeed(none.ctx.seller, { q: "mentoria" })).rejects.toMatchObject({ code: "forbidden" });
  });
});
