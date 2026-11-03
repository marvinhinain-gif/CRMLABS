import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { db } from "@/server/db";
import { leads, quizAssets, quizSubmissions } from "@/server/db/schema";
import { createForm, getForm, publishForm, saveDraft } from "@/server/services/quizzes";
import { recordEvent, submitQuiz } from "@/server/services/quizPublic";
import { getSubmission, listResponses } from "@/server/services/quizReports";
import { getLead } from "@/server/services/leads";
import { addTrackedLink, contentReport, listInstagramContent, snapshotContent } from "@/server/services/contentTracking";
import { linkSchema } from "@/lib/quiz/schema";
import { LINK_KIND_LABEL, type Answers } from "@/lib/quiz/types";
import { setInstagramApiForTests } from "@/server/integrations/instagram/client";
import { handleCallback, startConnect } from "@/server/integrations/instagram/oauth";
import { FakeInstagramApi, setupOrg } from "./helpers";

const A: Answers = { full_name: "Ana Souza", whatsapp: "(71) 99999-1111", business_profile: "P1", monthly_revenue_range: "R2", main_challenge: "D1", desired_outcome: "O1", operation_maturity: "M1", execution_capacity: "E1", start_timeline: "T1", investment_capacity: "B1", decision_authority: "A1" };
const meta = { ip: "10.0.0.9", userAgent: "vitest" };
const body = (answers: Answers, extra: Record<string, unknown> = {}) => ({ sessionId: randomUUID(), answers, consent: { notice: true, marketing: false }, startedAt: Date.now() - 90_000, ...extra });
const IMG = "https://scontent-gru1-1.cdninstagram.com/v/t51/foto.jpg";
const igMedia = (id: string, extra: Record<string, unknown> = {}) => ({ id, caption: ` Legenda ${id} `, mediaType: "IMAGE", permalink: `https://www.instagram.com/p/${id}/`, mediaUrl: IMG, timestamp: new Date().toISOString(), ...extra });

let api: FakeInstagramApi;
let png: Buffer;
const realFetch = globalThis.fetch;

beforeEach(async () => {
  api = new FakeInstagramApi();
  setInstagramApiForTests(api);
  png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#f00" } }).png().toBuffer();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

async function setup() {
  const env = await setupOrg();
  const url = new URL(await startConnect(env.ctx.admin));
  await handleCallback({ code: "abc", state: url.searchParams.get("state") }, env.ctx.admin);
  const f = await createForm(env.ctx.admin, { name: "Aplicação AXION", template: "axion-aplicacao" });
  await publishForm(env.ctx.admin, f.id);
  return { ...env, form: await getForm(env.ctx.admin, f.id) };
}
const stubImage = () => {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

describe("Rastreio do conteúdo de origem", () => {
  it("lista do Instagram: feed e stories; sem conta, conectado:false", async () => {
    const none = await setupOrg("Sem IG");
    expect(await listInstagramContent(none.ctx.admin, "feed")).toEqual({ connected: false, username: null, items: [] });
    const { ctx } = await setup();
    api.feed = [igMedia("m1"), igMedia("m2")];
    api.stories = [igMedia("s1", { mediaType: "VIDEO", thumbnailUrl: IMG })];
    const feed = await listInstagramContent(ctx.admin, "feed");
    expect(feed).toMatchObject({ connected: true, username: "olucaoferraz" });
    expect(feed.items.map((i) => i.externalId)).toEqual(["m1", "m2"]);
    expect(feed.items[0]).toMatchObject({ caption: "Legenda m1", previewUrl: IMG, permalink: "https://www.instagram.com/p/m1/" });
    const st = await listInstagramContent(ctx.admin, "stories");
    expect(st.items).toHaveLength(1);
    await expect(listInstagramContent(ctx.seller, "feed")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("snapshot guarda a foto em quiz_assets e recusa host que não é do Instagram", async () => {
    const { ctx, org } = await setup();
    const fetchMock = stubImage();
    api.feed = [igMedia("m1")];
    const c = await snapshotContent(ctx.admin, { type: "feed", externalId: "m1" });
    expect(c).toMatchObject({ source: "instagram", externalId: "m1", mediaType: "IMAGE", caption: "Legenda m1", permalink: "https://www.instagram.com/p/m1/" });
    expect(c.imageId).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [asset] = await db.select().from(quizAssets).where(eq(quizAssets.id, c.imageId!));
    expect(asset.orgId).toBe(org.id);

    // Host de fora do Instagram: nada é baixado, o conteúdo volta sem foto.
    fetchMock.mockClear();
    api.feed = [igMedia("m2", { mediaUrl: "https://evil.example.com/x.jpg" })];
    const bad = await snapshotContent(ctx.admin, { type: "feed", externalId: "m2" });
    expect(bad.imageId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    api.feed = [igMedia("m3", { mediaUrl: "http://scontent.cdninstagram.com/x.jpg" })];
    expect((await snapshotContent(ctx.admin, { type: "feed", externalId: "m3" })).imageId).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    // Stories: precisa estar na lista ativa; vídeo usa a miniatura.
    await expect(snapshotContent(ctx.admin, { type: "stories", externalId: "sumiu" })).rejects.toMatchObject({ code: "not_found", message: "Esse conteúdo não está mais disponível no Instagram." });
    api.stories = [igMedia("s1", { mediaType: "VIDEO", mediaUrl: "https://video.cdninstagram.com/v.mp4", thumbnailUrl: IMG })];
    expect((await snapshotContent(ctx.admin, { type: "stories", externalId: "s1" })).imageId).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(IMG, expect.anything());
  });

  it("addTrackedLink cria chave única e o envio com ?origem= é atribuído; relatório conta por conteúdo", async () => {
    const { ctx, org, form } = await setup();
    stubImage();
    api.feed = [igMedia("m1")];
    const content = await snapshotContent(ctx.admin, { type: "feed", externalId: "m1" });
    const a = await addTrackedLink(ctx.admin, form.id, { kind: "feed", label: "Post da Mentoria", content });
    const b = await addTrackedLink(ctx.admin, form.id, { kind: "feed", label: "Post da Mentoria", content: null });
    expect(a.link).toMatchObject({ key: "post-da-mentoria", kind: "feed", utmSource: "instagram", utmMedium: "feed", url: `${form.publicUrl}?origem=post-da-mentoria` });
    expect(a.link.sourceId).toBeTruthy();
    expect(a.link.content?.imageId).toBe(content.imageId);
    expect(b.link.key).toBe("post-da-mentoria-2");
    expect(b.links).toHaveLength(form.links.length + 2);
    const bio = await addTrackedLink(ctx.admin, form.id, { kind: "bio", label: "Bio", content: null });

    const view = async (origem: string) => recordEvent(form.slug, { sessionId: randomUUID(), kind: "view", origem }, `9.9.9.${Math.floor(Math.random() * 200)}`);
    await view("post-da-mentoria");
    await view("post-da-mentoria");
    await view("bio");
    await submitQuiz(form.slug, body(A, { origem: "post-da-mentoria" }), meta);
    await submitQuiz(form.slug, body({ ...A, full_name: "Bia", whatsapp: "(11) 98888-7777" }, { origem: "post-da-mentoria" }), meta);
    await submitQuiz(form.slug, body({ ...A, full_name: "Caio", whatsapp: "(21) 97777-6666" }, { origem: "bio" }), meta);
    await submitQuiz(form.slug, body({ ...A, full_name: "Dani", whatsapp: "(31) 96666-5555" }, { origem: "stories" }), meta);
    await submitQuiz(form.slug, body({ ...A, full_name: "Eva", whatsapp: "(41) 95555-4444" }), meta);
    const subs = await db.select().from(quizSubmissions).where(eq(quizSubmissions.orgId, org.id));
    expect(subs.filter((s) => s.linkKey === "post-da-mentoria")).toHaveLength(2);

    const rep = await contentReport(ctx.admin, { days: 30 });
    expect(rep.totalSignups).toBe(5);
    expect(rep.totals).toEqual([
      { kind: "stories", signups: 1 },
      { kind: "feed", signups: 2 },
      { kind: "bio", signups: 1 },
      { kind: "other", signups: 1 },
    ]);
    const row = rep.rows.find((r) => r.key === "post-da-mentoria")!;
    expect(row).toMatchObject({ formId: form.id, kind: "feed", views: 2, signups: 2, qualified: 2, url: a.link.url });
    expect(row.content).toMatchObject({ externalId: "m1", imageUrl: `/api/public/form-assets/${content.imageId}` });
    expect(row.lastSignupAt).toBeTruthy();
    expect(rep.rows[0].key).toBe("post-da-mentoria");
    expect(rep.rows.find((r) => r.key === "bio")).toMatchObject({ views: 1, signups: 1 });
    expect(rep.rows.find((r) => r.key === "stories")).toMatchObject({ signups: 1 });
    expect(rep.rows.find((r) => r.key === "post-da-mentoria-2")).toMatchObject({ signups: 0, content: null });
    expect(rep.rows.find((r) => r.key === "trafego")).toBeUndefined(); // tráfego sem conteúdo fica fora
    expect(bio.link.key).toBe("bio");
    expect((await contentReport(ctx.admin, { days: "all" })).totalSignups).toBe(5);
    // Fora do período: sem cadastros.
    await db.update(quizSubmissions).set({ completedAt: new Date(Date.now() - 40 * 86400_000) });
    expect((await contentReport(ctx.admin, { days: 30 })).totalSignups).toBe(0);
    expect((await contentReport(ctx.admin, { days: 90 })).totalSignups).toBe(5);

    // Filtro por link nas respostas, conteúdo na resposta individual e no lead.
    await db.update(quizSubmissions).set({ completedAt: new Date() });
    const list = await listResponses(ctx.admin, form.id, { link: "post-da-mentoria", duplicates: "hide" });
    expect(list.total).toBe(2);
    expect(list.rows[0]).toMatchObject({ linkKind: "feed", linkImageUrl: `/api/public/form-assets/${content.imageId}` });
    expect(list.rows[0]).not.toHaveProperty("linkKey");
    const all = await listResponses(ctx.admin, form.id, { duplicates: "hide" });
    expect(all.rows.find((r) => r.name === "Eva")).toMatchObject({ linkKind: null, linkImageUrl: null });
    const detail = await getSubmission(ctx.admin, list.rows[0].id);
    expect(detail.linkContent).toMatchObject({ key: "post-da-mentoria", label: "Post da Mentoria", kind: "feed", content: { permalink: "https://www.instagram.com/p/m1/", imageUrl: `/api/public/form-assets/${content.imageId}` } });
    expect((await getSubmission(ctx.admin, all.rows.find((r) => r.name === "Eva")!.id)).linkContent).toBeNull();
    const [lead] = await db.select().from(leads).where(eq(leads.id, list.rows[0].leadId!));
    const full = await getLead(ctx.admin, lead.id);
    expect(full.leadScore.application?.linkContent).toMatchObject({ key: "post-da-mentoria", kind: "feed" });
  });

  it("linkSchema recusa permalink fora do Instagram; imageId de outra organização é descartado", async () => {
    const base = { key: "x", label: "X", kind: "feed", sourceId: null, utmSource: "instagram", utmMedium: "feed", utmCampaign: null };
    const content = { source: "instagram", mediaType: "IMAGE", externalId: "1", permalink: "https://www.instagram.com/p/1/", caption: null, postedAt: null, imageId: null };
    expect(linkSchema.safeParse({ ...base, content }).success).toBe(true);
    expect(linkSchema.safeParse({ ...base, content: { ...content, permalink: "https://evil.com/p/1/" } }).success).toBe(false);
    expect(linkSchema.safeParse({ ...base, content: { ...content, permalink: "https://instagram.com.evil.com/p/1/" } }).success).toBe(false);
    expect(linkSchema.safeParse({ ...base, content: { ...content, imageId: "nao-uuid" } }).success).toBe(false);
    expect(linkSchema.safeParse({ ...base, content: { ...content, caption: "x".repeat(501) } }).success).toBe(false);
    expect(LINK_KIND_LABEL.feed).toBe("Post do feed");

    const { ctx, form } = await setup();
    const other = await setupOrg("Outra");
    const [foreign] = await db.insert(quizAssets).values({ orgId: other.org.id, data: png, mime: "image/png" }).returning();
    const [mine] = await db.insert(quizAssets).values({ orgId: ctx.admin.orgId, data: png, mime: "image/png" }).returning();
    const links = form.links.map(({ url: _u, ...l }) => l);
    const saved = await saveDraft(ctx.admin, form.id, {
      links: [...links, { ...base, key: "a", content: { ...content, source: "upload", imageId: foreign.id } }, { ...base, key: "b", content: { ...content, source: "upload", imageId: mine.id } }],
    });
    expect(saved.links.find((l) => l.key === "a")!.content!.imageId).toBeNull();
    expect(saved.links.find((l) => l.key === "b")!.content!.imageId).toBe(mine.id);
    // Links antigos continuam sem o campo `content`.
    expect(saved.links[0]).not.toHaveProperty("content");
  });
});
