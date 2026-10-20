/**
 * Top Engajados: ranking só com interações que a API oficial atribui a uma pessoa,
 * sem contar duas vezes, com teto anti-spam, status no CRM e permissões por papel.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { connectedAccounts, contacts, engagementEvents, relationshipEntries, socialComments } from "@/server/db/schema";
import { setInstagramApiForTests } from "@/server/integrations/instagram/client";
import { handleCallback, startConnect } from "@/server/integrations/instagram/oauth";
import { ingestWebhook, processPendingEvents } from "@/server/integrations/instagram/webhooks";
import { syncAccount } from "@/server/integrations/instagram/sync";
import { transformToLead } from "@/server/services/instagram";
import { collectEngagement, engagementPerson, engagementRanking, prepareLeadContact, updateEngagementConfig } from "@/server/services/engagement";
import { buildMe } from "@/server/services/me";
import { FakeInstagramApi, setupOrg } from "./helpers";

let api: FakeInstagramApi;
const IG = "17841400000000001";

beforeEach(() => {
  api = new FakeInstagramApi();
  setInstagramApiForTests(api);
  api.profiles = { "igsid-ana": { name: "Ana Souza", username: "ana.souza" }, "igsid-bruno": { name: "Bruno Lima", username: "bruno" }, "igsid-spam": { name: "Spam", username: "spam" }, "igsid-dani": { name: "Dani", username: "dani" } };
});

async function connected() {
  const s = await setupOrg();
  const url = new URL(await startConnect(s.ctx.admin));
  const account = await handleCallback({ code: "abc", state: url.searchParams.get("state") }, s.ctx.admin);
  return { ...s, account };
}

const now = () => Date.now();
const dm = (sender: string, mid: string, extra: Record<string, unknown> = {}) => ({ sender: { id: sender }, recipient: { id: IG }, timestamp: now(), message: { mid, text: "oi", ...extra } });
const comment = (id: string, from: string, username: string, media = "media-1", text = "Top demais") => ({ field: "comments", value: { id, text, from: { id: from, username }, media: { id: media, media_product_type: "REELS" }, timestamp: Math.floor(now() / 1000) } });

async function deliver(entry: { messaging?: unknown[]; changes?: unknown[] }) {
  await ingestWebhook(JSON.stringify({ object: "instagram", entry: [{ id: IG, time: now(), ...entry }] }));
  await processPendingEvents();
}

describe("Top Engajados", () => {
  it("pontua só ações individuais, sem duplicar webhooks reentregues nem a sincronização", async () => {
    const { ctx, account } = await connected();
    // Ana: 2 comentários + 1 resposta a story + 1 mensagem + 1 menção em story.
    await deliver({ changes: [comment("c1", "igsid-ana", "ana.souza"), comment("c2", "igsid-ana", "ana.souza", "media-2")] });
    await deliver({ messaging: [dm("igsid-ana", "m1"), dm("igsid-ana", "m2", { reply_to: { story: { url: "https://cdn/s", id: "s1" } } }), dm("igsid-ana", "m3", { text: undefined, attachments: [{ type: "story_mention", payload: { url: "https://cdn/m" } }] })] });
    // Bruno: compartilhou uma publicação no Direct.
    await deliver({ messaging: [dm("igsid-bruno", "m4", { text: undefined, attachments: [{ type: "ig_reel", payload: { url: "https://instagram.com/reel/x" } }] })] });
    // Reentrega do mesmo webhook e eco da própria conta: nada novo.
    await deliver({ messaging: [dm("igsid-ana", "m1"), { sender: { id: IG }, recipient: { id: "igsid-ana" }, timestamp: now(), message: { mid: "m-echo", text: "obrigado", is_echo: true } }] });
    await deliver({ changes: [comment("c-own", IG, "olucaoferraz")] });
    await collectEngagement();
    await collectEngagement();

    // A sincronização traz as mesmas mensagens: o mid deduplica, a interação não conta duas vezes.
    api.conversations = [{ id: "t1", participants: [{ id: IG, username: "olucaoferraz" }, { id: "igsid-ana", username: "ana.souza" }], messages: [{ id: "m1", createdTime: new Date().toISOString(), fromId: "igsid-ana", text: "oi", attachments: [] }] }];
    const [acc] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id));
    await syncAccount(acc, { parts: ["directs"] });
    await collectEngagement();
    expect(await db.select().from(engagementEvents)).toHaveLength(6);

    const r = await engagementRanking(ctx.seller, { period: "today", kind: "all" });
    expect(r.rows.map((p) => p.username)).toEqual(["ana.souza", "bruno"]);
    const ana = r.rows[0];
    // 2×5 (comentários) + 6 (Direct) + 8 (story) + 10 (menção) = 34
    // Contato do Direct sem responsável: o social seller não transforma (regra do fluxo existente); o gestor sim.
    expect(ana).toMatchObject({ position: 1, score: 34, interactions: 5, status: "none", canTransform: false });
    expect((await engagementRanking(ctx.manager, { period: "today", kind: "all" })).rows[0].canTransform).toBe(true);
    await expect(prepareLeadContact(ctx.seller, { key: ana.key })).rejects.toThrow(/responsável/);
    expect(ana.counts).toMatchObject({ comment: 2, dm: 1, story_reply: 1, story_mention: 1, dm_share: 0 });
    expect(r.rows[1]).toMatchObject({ position: 2, score: 7, counts: expect.objectContaining({ dm_share: 1 }) });
    expect(r.totals).toMatchObject({ people: 2, interactions: 6, comments: 2, directs: 4, opportunities: 2 });

    // Filtro por tipo muda o ranking.
    const comments = await engagementRanking(ctx.seller, { period: "today", kind: "comments" });
    expect(comments.rows).toHaveLength(1);
    expect(comments.rows[0]).toMatchObject({ score: 10, interactions: 2 });
    const shares = await engagementRanking(ctx.seller, { period: "today", kind: "shares" });
    expect(shares.rows.map((p) => p.score)).toEqual([7]);
    // Busca por @ mantém a posição do ranking geral.
    const search = await engagementRanking(ctx.seller, { period: "today", kind: "all", q: "@brun" });
    expect(search.rows).toHaveLength(1);
    expect(search.rows[0].position).toBe(2);
  });

  it("limita a pontuação de ações repetidas e ignora comentários ocultos e mensagens apagadas", async () => {
    const { ctx } = await connected();
    await deliver({ messaging: Array.from({ length: 9 }, (_, i) => dm("igsid-spam", `s${i}`)) });
    await deliver({ changes: [comment("c1", "igsid-x", "xavier"), comment("c2", "igsid-x", "xavier")] });
    await collectEngagement();
    let r = await engagementRanking(ctx.admin, { period: "today", kind: "all" });
    const spam = r.rows.find((p) => p.counts.dm === 9)!;
    expect(spam).toMatchObject({ interactions: 9, score: 5 * 6, capped: 4 });

    await updateEngagementConfig(ctx.admin, { dailyCap: 2, weights: { dm: 1 } });
    r = await engagementRanking(ctx.admin, { period: "today", kind: "all" });
    expect(r.rows.find((p) => p.counts.dm === 9)).toMatchObject({ score: 2, capped: 7 });

    await db.update(socialComments).set({ hiddenAt: new Date() }).where(eq(socialComments.externalId, "c2"));
    await deliver({ messaging: [{ sender: { id: "igsid-spam" }, recipient: { id: IG }, timestamp: now(), message: { mid: "s0", is_deleted: true } }] });
    r = await engagementRanking(ctx.admin, { period: "today", kind: "all" });
    expect(r.rows.find((p) => p.username === "xavier")).toMatchObject({ interactions: 1, score: 5 });
    expect(r.rows.find((p) => p.counts.dm > 0)?.counts.dm).toBe(8);

    // Somente o administrador altera pesos.
    await expect(updateEngagementConfig(ctx.seller, { dailyCap: 10 })).rejects.toThrow();
    await expect(updateEngagementConfig(ctx.manager, { dailyCap: 10 })).rejects.toThrow();
  });

  it("Transformar em Lead só depois da confirmação; status no CRM e closers sem acesso por padrão", async () => {
    const { ctx } = await connected();
    await deliver({ changes: [comment("c1", "igsid-carol", "carol"), comment("c2", "igsid-carol", "carol", "media-2")] });
    await collectEngagement();
    let r = await engagementRanking(ctx.seller, { period: "month", kind: "all" });
    const carol = r.rows[0];
    expect(carol).toMatchObject({ contactId: null, status: "none" });
    expect(await db.select().from(relationshipEntries)).toHaveLength(0); // nunca entra sozinho no Kanban

    // Prepara o contato (vinculado ao id oficial) sem criar Lead.
    const prep = await prepareLeadContact(ctx.seller, { key: carol.key });
    expect(prep.from).toBe("comment");
    expect(await db.select().from(relationshipEntries)).toHaveLength(0);
    const [ct] = await db.select().from(contacts).where(eq(contacts.id, prep.contact.id));
    expect(ct.username).toBe("carol");
    expect((await db.select().from(socialComments)).every((c) => c.contactId === ct.id)).toBe(true);
    // Repetir não duplica o contato.
    expect((await prepareLeadContact(ctx.seller, { key: carol.key })).contact.id).toBe(ct.id);

    await transformToLead(ctx.seller, prep.contact.id, { from: "comment" });
    r = await engagementRanking(ctx.seller, { period: "month", kind: "all" });
    expect(r.rows[0]).toMatchObject({ key: ct.id, status: "lead", canTransform: false });
    expect(r.totals.opportunities).toBe(0);
    // Outra seller vê o status, mas o contato fica com quem cuida dele.
    const other = await engagementRanking(ctx.seller2, { period: "month", kind: "all" });
    expect(other.rows[0]).toMatchObject({ status: "lead", canTransform: false, ownerName: "Mariana" });

    // Perfil detalhado com atividades e link para a interação original.
    const person = await engagementPerson(ctx.seller, { key: ct.id, period: "month", kind: "all" });
    expect(person).toMatchObject({ position: 1, score: 10, status: "lead" });
    expect(person.activities).toHaveLength(2);
    expect(person.activities[0]).toMatchObject({ kind: "comment", text: "Top demais", restricted: false });
    expect(person.activities[0].link).toContain("/instagram?aba=comentarios&post=");

    // Closer: sem acesso até o administrador liberar.
    await expect(engagementRanking(ctx.closer, { period: "month", kind: "all" })).rejects.toThrow(/closers/);
    expect((await buildMe(ctx.closer)).permissions.engagement).toBe(false);
    await updateEngagementConfig(ctx.admin, { closersCanView: true });
    expect((await engagementRanking(ctx.closer, { period: "month", kind: "all" })).rows).toHaveLength(1);
  });

  it("não mostra o conteúdo do Direct de contatos de outra pessoa", async () => {
    const { ctx } = await connected();
    await deliver({ messaging: [dm("igsid-dani", "d1", { text: "Quero saber do programa" })] });
    await collectEngagement();
    const [c] = await db.select().from(contacts);
    await db.update(contacts).set({ ownerId: ctx.seller2.userId }).where(eq(contacts.id, c.id));
    const r = await engagementRanking(ctx.seller, { period: "today", kind: "all" });
    expect(r.rows[0]).toMatchObject({ key: c.id, canTransform: false, ownerName: "Rafael" });
    const forSeller = await engagementPerson(ctx.seller, { key: c.id, period: "today", kind: "all" });
    expect(forSeller.activities[0]).toMatchObject({ text: null, restricted: true, link: null });
    const forOwner = await engagementPerson(ctx.seller2, { key: c.id, period: "today", kind: "all" });
    expect(forOwner.activities[0]).toMatchObject({ text: "Quero saber do programa", restricted: false });
    await expect(prepareLeadContact(ctx.seller, { key: c.id })).rejects.toThrow(/Rafael/);
  });
});
