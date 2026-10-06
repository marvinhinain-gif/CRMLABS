/**
 * Correções prioritárias: sincronização completa do Direct, busca no banco,
 * contato do Instagram ≠ Lead, "Transformar em Lead" sem duplicar, Stories e revisão do administrador.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { auditEvents, connectedAccounts, contacts, conversations, notes, pipelineStages, products, relationshipEntries, stageHistory } from "@/server/db/schema";
import { setInstagramApiForTests, type ConversationItem } from "@/server/integrations/instagram/client";
import { handleCallback, startConnect } from "@/server/integrations/instagram/oauth";
import { ingestWebhook, processPendingEvents } from "@/server/integrations/instagram/webhooks";
import { syncAccount } from "@/server/integrations/instagram/sync";
import { listConversations, sendMessage } from "@/server/services/conversations";
import { randomUUID } from "node:crypto";
import { getBoard } from "@/server/services/board";
import { inboxSummary, instagramHistory, leadSummary, transformLeadOptions, transformToLead } from "@/server/services/instagram";
import { listAutoEntries, reviewAutoEntries } from "@/server/services/leadReview";
import { getPipeline } from "@/server/services/common";
import { FakeInstagramApi, setupOrg } from "./helpers";

let api: FakeInstagramApi;
const IG = "17841400000000001";

beforeEach(() => {
  api = new FakeInstagramApi();
  setInstagramApiForTests(api);
});

async function connected() {
  const s = await setupOrg();
  const url = new URL(await startConnect(s.ctx.admin));
  const account = await handleCallback({ code: "abc", state: url.searchParams.get("state") }, s.ctx.admin);
  return { ...s, account };
}
const freshAccount = async (id: string) => (await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, id)))[0];
type SyncResult = { backfill?: { done: boolean; pages: number } | null };
const sync = async (id: string) => (await syncAccount(await freshAccount(id), { parts: ["directs"] })) as SyncResult;
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

/** N conversas, da mais recente para a mais antiga (como a API devolve). */
function inbox(n: number): ConversationItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`,
    updatedTime: iso(i * 60),
    participants: [{ id: IG, username: "olucaoferraz" }, { id: `igsid-${i}`, username: `pessoa${i}` }],
    messages: [{ id: `m${i}`, createdTime: iso(i * 60), fromId: `igsid-${i}`, text: i === 57 ? "Oi, lembra de mim? Falamos da mentoria em março" : `mensagem ${i}`, attachments: [] }],
  }));
}

const DM = (mid: string, from: string, text: string) =>
  JSON.stringify({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: IG }, timestamp: Date.now(), message: { mid, text } }] }] });

describe("Directs: sincronização completa e busca", () => {
  it("importa todas as páginas da API (retomando pelo cursor) e encontra conversa antiga pela busca", async () => {
    const { ctx, account } = await connected();
    api.conversations = inbox(400); // 16 páginas de 25
    // Nome e foto oficiais chegam aos poucos (cota da API), das conversas mais recentes para as mais antigas.
    for (let i = 0; i < 400; i++) api.profiles[`igsid-${i}`] = { name: i === 30 ? "Marina Albuquerque" : `Pessoa ${i}`, username: `pessoa${i}` };

    let r = await sync(account.id);
    expect(r.backfill).toMatchObject({ done: false });
    // Sem a sincronização completa, a conversa antiga ainda não está no banco.
    expect((await listConversations(ctx.admin, { filter: "all", q: "pessoa350", limit: 30 })).rows).toHaveLength(0);
    expect((await inboxSummary(ctx.admin)).directSync).toMatchObject({ done: false });

    for (let i = 0; i < 6 && !r.backfill?.done; i++) r = await sync(account.id);
    expect(r.backfill).toMatchObject({ done: true, pages: 16 });
    expect(await db.select().from(conversations)).toHaveLength(400);
    expect((await inboxSummary(ctx.admin)).directSync).toMatchObject({ done: true, conversations: 400 });

    // 1. Conversa antiga encontrada pela busca (fora da lista carregada na tela): @, nome, ID do Instagram, texto.
    const byUser = await listConversations(ctx.admin, { filter: "all", q: "@pessoa350", limit: 30 });
    expect(byUser.rows.map((x) => x.contactUsername)).toEqual(["pessoa350"]);
    const byName = await listConversations(ctx.admin, { filter: "all", q: "marina alb", limit: 30 });
    expect(byName.rows.map((x) => x.contactName)).toEqual(["Marina Albuquerque"]);
    const byText = await listConversations(ctx.admin, { filter: "all", q: "mentoria em março", limit: 30 });
    expect(byText.rows.map((x) => x.contactUsername)).toEqual(["pessoa57"]);
    const byIgsid = await listConversations(ctx.admin, { filter: "all", q: "igsid-151", limit: 30 });
    expect(byIgsid.rows.map((x) => x.contactUsername)).toEqual(["pessoa151"]);
    expect((await listConversations(ctx.admin, { filter: "all", q: "ninguém-com-esse-nome", limit: 30 })).rows).toHaveLength(0);

    // Já em dia: a próxima sincronização lê só a primeira página e para.
    const before = api.count("listConversations");
    await syncAccount(await freshAccount(account.id), { parts: ["directs"] });
    expect(api.count("listConversations") - before).toBe(1);

    // 3. Ninguém virou Lead por ter conversa.
    expect(await db.select().from(relationshipEntries)).toHaveLength(0);
  });

  it("2. rolagem paginada sem pular nem repetir conversas (mesmo com horários iguais)", async () => {
    const { ctx, account } = await connected();
    const same = iso(10);
    api.conversations = inbox(70).map((c, i) => (i >= 20 && i < 45 ? { ...c, updatedTime: same, messages: c.messages.map((m) => ({ ...m, createdTime: same })) } : c));
    let r = await sync(account.id);
    while (!r.backfill?.done) r = await sync(account.id);
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const p = await listConversations(ctx.admin, { filter: "all", limit: 20, cursor });
      seen.push(...p.rows.map((x) => x.id));
      if (!p.nextCursor) break;
      cursor = p.nextCursor;
    }
    expect(seen).toHaveLength(70);
    expect(new Set(seen).size).toBe(70);
  });
});

describe("Contato do Instagram × Lead comercial", () => {
  it("3–5. Direct pessoal não entra no Kanban; Transformar em Lead coloca no funil; nunca duplica", async () => {
    const { ctx, org } = await connected();
    await ingestWebhook(DM("mid.1", "igsid-amiga", "Oi! Tudo bem? Saudade"));
    await processPendingEvents();
    const [conv] = await db.select().from(conversations);
    // 3. Aparece no Direct…
    expect((await listConversations(ctx.admin, { filter: "all", limit: 30 })).rows).toHaveLength(1);
    expect((await listConversations(ctx.admin, { filter: "all", limit: 30 })).rows[0].isLead).toBe(false);
    // …mas não no Kanban do Social Seller.
    const board = await getBoard(ctx.admin, {});
    expect(board.stages.flatMap((s) => s.cards)).toHaveLength(0);
    expect(await leadSummary(ctx.admin, conv.contactId)).toMatchObject({ isLead: false, autoEntry: false, stage: null });

    // 4. Transformar em Lead (etapa, responsável, produto, observação).
    const opts = await transformLeadOptions(ctx.admin);
    const stage = opts.stages[1];
    const [prod] = await db.insert(products).values({ orgId: org.id, name: "Mentoria" }).returning();
    const s = await transformToLead(ctx.admin, conv.contactId, { from: "direct", stageId: stage.id, ownerId: ctx.seller.userId, productId: prod.id, note: "Veio pelo Direct perguntando da mentoria" });
    expect(s).toMatchObject({ isLead: true, product: "Mentoria", stage: { name: stage.name }, origin: { name: "Instagram Direct" } });
    const after = await getBoard(ctx.admin, {});
    expect(after.stages.find((x) => x.id === stage.id)?.cards.map((c) => c.contactId)).toEqual([conv.contactId]);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, conv.contactId));
    expect(c.ownerId).toBe(ctx.seller.userId);
    expect((await db.select().from(conversations).where(eq(conversations.id, conv.id)))[0].ownerId).toBe(ctx.seller.userId);
    expect(await db.select().from(notes).where(eq(notes.contactId, conv.contactId))).toHaveLength(1);
    const [entry] = await db.select().from(relationshipEntries);
    expect(entry).toMatchObject({ origin: "instagram_direct", productId: prod.id, autoCreated: false, createdBy: ctx.admin.userId });

    // 5. De novo → recusa, sem duplicar.
    await expect(transformToLead(ctx.admin, conv.contactId, { from: "direct" })).rejects.toMatchObject({ code: "conflict", message: "Este contato já é um Lead." });
    expect(await db.select().from(relationshipEntries)).toHaveLength(1);

    // Mesmo @ cadastrado em outro contato que já é Lead → aponta para ele.
    const [manual] = await db.insert(contacts).values({ orgId: org.id, name: "Joana (cadastro manual)", username: "joana", source: "manual" }).returning();
    const rel = await getPipeline(org.id, "relationship");
    const [first] = await db.select().from(pipelineStages).where(and(eq(pipelineStages.pipelineId, rel.id), isNull(pipelineStages.archivedAt))).limit(1);
    await db.insert(relationshipEntries).values({ orgId: org.id, pipelineId: rel.id, contactId: manual.id, stageId: first.id });
    api.profiles["igsid-joana"] = { name: "Joana", username: "joana" };
    await ingestWebhook(DM("mid.2", "igsid-joana", "Quero saber valores"));
    await processPendingEvents();
    const [joanaConv] = await db.select().from(conversations).where(eq(conversations.id, (await listConversations(ctx.admin, { filter: "all", q: "valores", limit: 5 })).rows[0].id));
    expect(joanaConv.contactId).not.toBe(manual.id);
    expect((await leadSummary(ctx.admin, joanaConv.contactId))?.duplicateOf).toMatchObject({ id: manual.id });
    await expect(transformToLead(ctx.admin, joanaConv.contactId, { from: "direct" })).rejects.toMatchObject({ code: "conflict", details: { leadContactId: manual.id } });

    // Seller não escolhe outro responsável.
    await ingestWebhook(DM("mid.3", "igsid-x", "oi"));
    await processPendingEvents();
    const xConv = (await listConversations(ctx.admin, { filter: "all", q: "anasouza", limit: 5 })).rows[0];
    await expect(transformToLead(ctx.seller, xConv.contactId, { ownerId: ctx.admin.userId, from: "direct" })).rejects.toBeTruthy();

    // Histórico do administrador registra quem transformou.
    const h = await instagramHistory(ctx.admin, { kind: "leads" });
    expect(h.rows[0]).toMatchObject({ action: "instagram.lead_created", actorName: "Admin" });
    expect(h.rows[0].data).toMatchObject({ stage: stage.name, product: "Mentoria" });
  });

  it("revisão do administrador: cartões automáticos antigos não contam como Lead e saem só por decisão manual", async () => {
    const { ctx, org } = await connected();
    for (const [mid, who] of [["a1", "igsid-a"], ["b1", "igsid-b"], ["c1", "igsid-c"]]) {
      api.profiles[who] = { name: who, username: who.replace("igsid-", "user_") };
      await ingestWebhook(DM(mid, who, "oi"));
    }
    await processPendingEvents();
    // Simula a regra antiga: os três entraram sozinhos no Kanban.
    const rel = await getPipeline(org.id, "relationship");
    const [first] = await db.select().from(pipelineStages).where(eq(pipelineStages.pipelineId, rel.id)).limit(1);
    const people = await db.select().from(contacts);
    for (const p of people) {
      const [e] = await db.insert(relationshipEntries).values({ orgId: org.id, pipelineId: rel.id, contactId: p.id, stageId: first.id, autoCreated: true, origin: "instagram_direct" }).returning();
      await db.insert(stageHistory).values({ orgId: org.id, entityType: "relationship", entityId: e.id, contactId: p.id, toStageId: first.id, toStageName: first.name, reason: "Mensagem recebida" });
    }
    expect(await leadSummary(ctx.admin, people[0].id)).toMatchObject({ isLead: false, autoEntry: true });
    expect((await inboxSummary(ctx.admin)).autoLeadsToReview).toBe(3);
    expect((await inboxSummary(ctx.seller)).autoLeadsToReview).toBe(0);
    await expect(listAutoEntries(ctx.manager)).rejects.toMatchObject({ code: "forbidden" });

    const list = await listAutoEntries(ctx.admin);
    expect(list.rows).toHaveLength(3);
    const [a, b, c] = list.rows;
    // Remover do Kanban: fecha o cartão; contato e conversa continuam.
    await reviewAutoEntries(ctx.admin, { entryIds: [a.entryId], action: "remove" });
    // Manter como Lead: confirma o cartão.
    await reviewAutoEntries(ctx.admin, { entryIds: [b.entryId], action: "keep" });
    expect(await leadSummary(ctx.admin, b.contactId)).toMatchObject({ isLead: true });
    expect(await leadSummary(ctx.admin, a.contactId)).toMatchObject({ isLead: false, autoEntry: false });
    expect(await db.select().from(contacts)).toHaveLength(3);
    expect(await db.select().from(conversations)).toHaveLength(3);
    expect((await listAutoEntries(ctx.admin)).rows.map((x) => x.entryId)).toEqual([c.entryId]);

    // Transformar em Lead aproveita o cartão automático (sem criar outro).
    await transformToLead(ctx.admin, c.contactId, { from: "direct" });
    const active = await db.select().from(relationshipEntries).where(and(eq(relationshipEntries.contactId, c.contactId), isNull(relationshipEntries.closedAt)));
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ id: c.entryId, autoCreated: false });
    const actions = (await db.select().from(auditEvents)).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(["instagram.lead_review_removed", "instagram.lead_review_kept", "instagram.lead_created"]));
  });
});

describe("Stories pela API oficial", () => {
  it("8. resposta e menção a story chegam no Direct, entram no filtro Stories e não criam Lead", async () => {
    const { ctx } = await connected();
    await ingestWebhook(JSON.stringify({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: "igsid-s" }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: "s.1", text: "que lindo!", reply_to: { story: { url: "https://cdn/story.jpg", id: "story.1" } } } }] }] }));
    await ingestWebhook(JSON.stringify({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: "igsid-m" }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: "s.2", attachments: [{ type: "story_mention", payload: { url: "https://cdn/mention.jpg" } }] } }] }] }));
    await ingestWebhook(DM("s.3", "igsid-n", "mensagem comum"));
    await processPendingEvents();
    const stories = await listConversations(ctx.admin, { filter: "stories", limit: 30 });
    expect(stories.rows.map((r) => r.lastMessagePreview).sort()).toEqual(["Mencionou você no story", "Respondeu ao seu story: que lindo!"]);
    expect(await db.select().from(relationshipEntries)).toHaveLength(0);
    // Responder ao story é uma resposta no Direct (dentro da janela) e entra no histórico como resposta a story.
    const replyTo = stories.rows.find((r) => r.lastMessagePreview?.startsWith("Respondeu"))!;
    await sendMessage(ctx.admin, replyTo.id, { text: "Obrigado! 💚", clientRequestId: randomUUID() });
    const h = await instagramHistory(ctx.admin, { kind: "directs" });
    expect(h.rows[0]).toMatchObject({ action: "instagram.dm_sent", data: { story: true } });
  });
});
