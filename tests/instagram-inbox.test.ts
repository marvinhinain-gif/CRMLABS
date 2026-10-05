/**
 * Caixa de entrada comercial do Instagram (Directs, Comentários, Pendente/Resolvido, Histórico)
 * com o adaptador falso da API oficial.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { connectedAccounts, conversations, messages, relationshipEntries, socialComments, socialPosts } from "@/server/db/schema";
import { setInstagramApiForTests } from "@/server/integrations/instagram/client";
import { handleCallback, startConnect } from "@/server/integrations/instagram/oauth";
import { ingestWebhook, processPendingEvents } from "@/server/integrations/instagram/webhooks";
import { syncAccount } from "@/server/integrations/instagram/sync";
import { getConversation, listConversations, resolveConversation, sendMessage } from "@/server/services/conversations";
import { replyToComment } from "@/server/services/comments";
import { commentOnPost, createLeadFromInstagram, deleteComment, getPostThread, hideComment, inboxSummary, instagramHistory, leadSummary, listCommentPosts, resolveAllOnPost, resolveComment } from "@/server/services/instagram";
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

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();

describe("Directs", () => {
  it("sincroniza pela API oficial, mostra quem espera resposta e resolve/reabre", async () => {
    const { ctx, account } = await connected();
    api.conversations = [
      {
        id: "t1",
        participants: [{ id: IG, username: "olucaoferraz" }, { id: "igsid-bruna", username: "brunabonicontro" }],
        messages: [
          { id: "m3", createdTime: iso(5), fromId: "igsid-bruna", attachments: [{ type: "share", url: "https://instagram.com/p/x" }] },
          { id: "m2", createdTime: iso(30), fromId: "igsid-bruna", text: "Quanto custa a mentoria?", attachments: [] },
          { id: "m1", createdTime: iso(60), fromId: IG, fromUsername: "olucaoferraz", text: "Oi Bruna!", attachments: [] },
        ],
      },
      { id: "t2", participants: [{ id: IG }, { id: "igsid-wesley", username: "wesley" }], messages: [{ id: "m4", createdTime: iso(90), fromId: IG, text: "Valeu!", attachments: [] }] },
    ];
    // Conectada há pouco: as mensagens de agora contam como novas.
    await db.update(connectedAccounts).set({ connectedAt: new Date(Date.now() - 3 * 3600_000) }).where(eq(connectedAccounts.id, account.id));
    const [acc] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id));
    const r = await syncAccount(acc, { parts: ["directs"] });
    expect(r).toMatchObject({ conversations: 2, newMessages: 4 });
    await syncAccount(acc, { parts: ["directs"] }); // de novo: não duplica
    expect(await db.select().from(messages)).toHaveLength(4);

    const pending = await listConversations(ctx.admin, { filter: "pending", limit: 30 });
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0]).toMatchObject({ pendingCount: 2, lastMessagePreview: "Compartilhou uma publicação" });
    expect((await listConversations(ctx.admin, { filter: "all", limit: 30 })).rows).toHaveLength(2);
    // Pesquisa pelo conteúdo da conversa.
    expect((await listConversations(ctx.admin, { filter: "all", q: "mentoria", limit: 30 })).rows.map((x) => x.id)).toEqual([pending.rows[0].id]);
    expect((await inboxSummary(ctx.admin)).pendingDirects).toBe(1);

    const conv = pending.rows[0];
    await resolveConversation(ctx.seller, conv.id, true).catch(() => null); // seller sem acesso à conversa
    await resolveConversation(ctx.admin, conv.id, true);
    expect((await inboxSummary(ctx.admin)).pendingDirects).toBe(0);
    // Nova mensagem do contato depois da resolução → volta para pendente.
    await ingestWebhook(JSON.stringify({ object: "instagram", entry: [{ id: IG, time: Date.now(), messaging: [{ sender: { id: "igsid-bruna" }, recipient: { id: IG }, timestamp: Date.now(), message: { mid: "m5", reply_to: { story: { url: "https://cdn/story", id: "s1" } }, text: "amei" } }] }] }));
    await processPendingEvents();
    const again = await listConversations(ctx.admin, { filter: "pending", limit: 30 });
    expect(again.rows[0]).toMatchObject({ pendingCount: 1, lastMessagePreview: "Respondeu ao seu story: amei" });

    // Responder pelo CRM tira de "Sem resposta" e entra no histórico do administrador.
    await sendMessage(ctx.admin, conv.id, { text: "Te mando os detalhes!", clientRequestId: randomUUID() });
    expect((await listConversations(ctx.admin, { filter: "pending", limit: 30 })).rows).toHaveLength(0);
    const detail = await getConversation(ctx.admin, conv.id, { limit: 40 });
    expect(detail.messages.find((m) => m.body === "amei")?.attachments).toEqual([{ type: "story_reply", url: "https://cdn/story" }]);
    const h = await instagramHistory(ctx.admin, { kind: "directs" });
    expect(h.rows.map((x) => x.action)).toEqual(["instagram.dm_sent", "instagram.dm_resolved"]);
    expect(h.rows[0]).toMatchObject({ actorName: "Admin", roleLabel: "Administrador", link: `/instagram?aba=directs&c=${conv.id}` });
    await expect(instagramHistory(ctx.manager, { kind: "all" })).rejects.toMatchObject({ code: "forbidden" });

    // Contexto comercial: ainda não é lead → "Criar Lead" coloca no funil e assume o responsável.
    const [c] = await db.select().from(conversations).where(eq(conversations.id, conv.id));
    await db.delete(relationshipEntries).where(eq(relationshipEntries.contactId, c.contactId));
    expect((await leadSummary(ctx.admin, c.contactId))?.isLead).toBe(false);
    const lead = await createLeadFromInstagram(ctx.seller, c.contactId, "direct").catch(() => null);
    expect(lead).toBeNull(); // seller não vê esse contato
    const ok = await createLeadFromInstagram(ctx.admin, c.contactId, "direct");
    expect(ok).toMatchObject({ isLead: true, ownerName: "Admin" });
  });
});

describe("Comentários por publicação", () => {
  it("agrupa por publicação, árvore de respostas, resolve, auto-resolve com resposta da conta, ocultar/excluir e comentar", async () => {
    const { ctx, account } = await connected();
    api.media = [
      {
        id: "media.1",
        caption: "Quando você já faz R$10 mil com um produto…\nSegue @olucaoferraz",
        mediaType: "VIDEO",
        mediaUrl: "https://cdn/v.mp4",
        thumbnailUrl: "https://cdn/t.jpg",
        likeCount: 4,
        commentsCount: 5,
        timestamp: iso(600),
        comments: [
          { id: "c1", text: "E pra sair de 100k para 500k?", timestamp: iso(300), username: "caiq.uejuann", fromId: "u-caiq", likeCount: 1 },
          { id: "c2", text: "acho que é focar no LTV", timestamp: iso(120), username: "gaby_bagdal", fromId: "u-gaby", parentId: "c1" },
          { id: "c3", text: "Essa parte do criativo é a sacada!", timestamp: iso(360), username: "opereira.mkt", fromId: "u-ope" },
          { id: "c4", text: "tmj meu irmão", timestamp: iso(240), username: "olucaoferraz", fromId: IG, parentId: "c3" },
          { id: "c5", text: "Só conteúdo de valor", timestamp: iso(200), username: "_lucasneves77", fromId: "u-lucas" },
        ],
      },
    ];
    const [acc] = await db.select().from(connectedAccounts).where(eq(connectedAccounts.id, account.id));
    await syncAccount(acc, { parts: ["comments"] });
    await syncAccount(acc, { parts: ["comments"] });
    expect(await db.select().from(socialComments)).toHaveLength(5);

    // c3 foi respondido pela própria conta no Instagram → já resolvido.
    const list = await listCommentPosts(ctx.admin, { filter: "pending", limit: 30, offset: 0 });
    expect(list.pendingTotal).toBe(3);
    expect(list.rows[0]).toMatchObject({ pending: 3, total: 4, authorsCount: 3 });
    const [post] = await db.select().from(socialPosts);
    expect(post).toMatchObject({ likeCount: 4, commentsCount: 5, mediaUrl: "https://cdn/v.mp4" });
    expect((await listCommentPosts(ctx.admin, { filter: "all", q: "sacada", limit: 30, offset: 0 })).rows).toHaveLength(1);

    let t = await getPostThread(ctx.admin, post.id);
    const byExt = (id: string) => t.thread.find((x) => x.externalId === id)!;
    expect(t.thread.map((x) => x.externalId)).toEqual(["c3", "c1", "c5"]);
    expect(byExt("c1")).toMatchObject({ pending: true, threadPending: true, likeCount: 1 });
    expect(byExt("c1").replies.map((x) => x.externalId)).toEqual(["c2"]);
    expect(byExt("c3")).toMatchObject({ pending: false, threadPending: false });

    // Responder uma resposta vai para o comentário principal, com @menção.
    const c2 = byExt("c1").replies[0];
    await replyToComment(ctx.admin, c2.id, { kind: "public", text: "boa!", clientRequestId: randomUUID() });
    expect(api.calls.find((c) => c.method === "replyToComment")?.args.slice(1)).toEqual(["c1", "@gaby_bagdal boa!"]);
    t = await getPostThread(ctx.admin, post.id);
    expect(byExt("c1").replies.map((x) => x.text)).toEqual(["acho que é focar no LTV", "@gaby_bagdal boa!"]);
    expect(byExt("c1").replies[0].pending).toBe(false);

    await resolveComment(ctx.seller, byExt("c5").id).catch(() => null);
    await resolveComment(ctx.admin, byExt("c5").id);
    expect((await inboxSummary(ctx.admin)).pendingComments).toBe(1);
    await hideComment(ctx.admin, byExt("c1").id, true);
    expect(api.count("hideComment")).toBe(1);
    expect((await inboxSummary(ctx.admin)).pendingComments).toBe(0);
    await expect(deleteComment(ctx.seller, byExt("c5").id)).rejects.toMatchObject({ code: "forbidden" });
    await deleteComment(ctx.admin, byExt("c5").id);
    t = await getPostThread(ctx.admin, post.id);
    expect(t.thread.map((x) => x.externalId)).toEqual(["c3", "c1"]);

    await commentOnPost(ctx.admin, post.id, { text: "Obrigado pelos comentários!" });
    expect(api.calls.find((c) => c.method === "commentOnMedia")?.args.slice(1)).toEqual(["media.1", "Obrigado pelos comentários!"]);
    expect((await getPostThread(ctx.admin, post.id)).thread.some((x) => x.isOwn && x.text === "Obrigado pelos comentários!")).toBe(true);

    // Nova resposta de alguém → pendente; resolver todos.
    await ingestWebhook(JSON.stringify({ object: "instagram", entry: [{ id: IG, changes: [{ field: "comments", value: { id: "c6", text: "e o preço?", parent_id: "c3", from: { id: "u-ope", username: "opereira.mkt" }, media: { id: "media.1" }, timestamp: Math.floor(Date.now() / 1000) } }] }] }));
    await processPendingEvents();
    expect((await inboxSummary(ctx.admin)).pendingComments).toBe(1);
    expect(await resolveAllOnPost(ctx.admin, post.id)).toEqual({ resolved: 1 });

    const h = await instagramHistory(ctx.admin, { kind: "comments" });
    expect(h.rows.map((x) => x.action)).toEqual(expect.arrayContaining(["instagram.comment_replied", "instagram.comment_resolved", "instagram.comment_hidden", "instagram.comment_deleted", "instagram.post_commented", "instagram.comments_resolved_all"]));
    const replied = h.rows.find((x) => x.action === "instagram.comment_replied")!;
    expect(replied.data).toMatchObject({ author: "gaby_bagdal", postCaption: expect.stringContaining("Quando você já faz R$10 mil") });
    expect(replied.link).toBe(`/instagram?aba=comentarios&post=${post.id}&comentario=${c2.id}`);
    void and;
  });
});
