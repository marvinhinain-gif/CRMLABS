/**
 * Testes de CONTRATO da integração com o Instagram, usando um adaptador falso.
 * Não substituem o teste real com conta autorizada (ver README → "Validação real").
 */
import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { accountSecrets, channelIdentities, connectedAccounts, contacts, conversations, messages, relationshipEntries, socialComments, webhookEvents } from "@/server/db/schema";
import { setInstagramApiForTests } from "@/server/integrations/instagram/client";
import { disconnectAccount, handleCallback, startConnect, handleDeauthorize } from "@/server/integrations/instagram/oauth";
import { ingestWebhook, processPendingEvents, verifySignature, splitPayload } from "@/server/integrations/instagram/webhooks";
import { hmacSha256Hex, decryptSecret } from "@/server/crypto";
import { getConversation, reconcileMessage, resendMessage, sendMessage } from "@/server/services/conversations";
import { createContact } from "@/server/services/contacts";
import { listComments, replyToComment } from "@/server/services/comments";
import { FakeInstagramApi, setupOrg } from "./helpers";

let api: FakeInstagramApi;
const IG = "17841400000000001";

beforeEach(() => {
  api = new FakeInstagramApi();
  setInstagramApiForTests(api);
});

async function connect(adminCtx: Awaited<ReturnType<typeof setupOrg>>["ctx"]["admin"]) {
  const url = new URL(await startConnect(adminCtx));
  return handleCallback({ code: "abc#_", state: url.searchParams.get("state") }, adminCtx);
}

function dm(mid: string, from: string, text: string, ts = Date.now(), echo = false) {
  return JSON.stringify({
    object: "instagram",
    entry: [{ id: IG, time: ts, messaging: [{ sender: { id: echo ? IG : from }, recipient: { id: echo ? from : IG }, timestamp: ts, message: { mid, text, ...(echo ? { is_echo: true } : {}) } }] }],
  });
}

describe("OAuth e status da conexão", () => {
  it("valida state, guarda token criptografado e só marca Conectado após teste real", async () => {
    const { ctx } = await setupOrg();
    const acc = await connect(ctx.admin);
    expect(acc.status).toBe("connected");
    expect(acc.webhooksSubscribed).toBe(true);
    expect(api.count("getMe")).toBeGreaterThanOrEqual(2); // conexão + teste
    const [secret] = await db.select().from(accountSecrets).where(eq(accountSecrets.accountId, acc.id));
    expect(secret.accessTokenEnc).not.toContain("long-token-secret");
    expect(decryptSecret(secret.accessTokenEnc)).toBe("long-token-secret");
  });

  it("rejeita state reutilizado, de outra sessão ou de outro administrador", async () => {
    const { ctx } = await setupOrg();
    const state = new URL(await startConnect(ctx.admin)).searchParams.get("state");
    await expect(handleCallback({ code: "x", state }, ctx.manager)).rejects.toMatchObject({ code: "forbidden" });
    await expect(handleCallback({ code: "x", state }, ctx.admin)).rejects.toMatchObject({ code: "invalid" }); // já consumido
    await expect(handleCallback({ code: "x", state: "inventado" }, ctx.admin)).rejects.toMatchObject({ code: "invalid" });
  });

  it("permissão não concedida resulta em 'Permissão insuficiente'", async () => {
    const { ctx } = await setupOrg();
    api.grantedPermissions = ["instagram_business_basic"];
    const acc = await connect(ctx.admin);
    expect(acc.status).toBe("insufficient_permission");
  });

  it("desconexão e revogação impedem novos eventos e envios", async () => {
    const { ctx } = await setupOrg();
    const acc = await connect(ctx.admin);
    await ingestWebhook(dm("m1", "igsid-ana", "Oi"));
    await processPendingEvents();
    const [conv] = await db.select().from(conversations);
    await disconnectAccount(ctx.admin, acc.id);
    expect(await db.select().from(accountSecrets)).toHaveLength(0);
    const r = await ingestWebhook(dm("m2", "igsid-ana", "Ainda aí?"));
    expect(r.queued).toBe(1);
    const [ev] = await db.select().from(webhookEvents).where(eq(webhookEvents.eventKey, `messages:${IG}:m2`));
    expect(ev.status).toBe("ignored");
    await expect(sendMessage(ctx.admin, conv.id, { text: "Olá", clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "channel_unavailable" });
    expect(await handleDeauthorize(IG)).toBe(1);
  });
});

describe("Webhooks: assinatura, fila e deduplicação", () => {
  it("valida X-Hub-Signature-256", () => {
    const body = dm("m1", "u", "oi");
    expect(verifySignature(body, `sha256=${hmacSha256Hex("test-app-secret", body)}`)).toBe(true);
    expect(verifySignature(body, `sha256=${hmacSha256Hex("outro", body)}`)).toBe(false);
    expect(verifySignature(body, null)).toBe(false);
  });

  it("evento duplicado não cria contato, conversa ou mensagem duplicados (e conversa não vira Lead)", async () => {
    const { ctx } = await setupOrg();
    await connect(ctx.admin);
    const body = dm("mid.1", "igsid-ana", "Quero entender a consultoria.");
    expect((await ingestWebhook(body)).queued).toBe(1);
    expect((await ingestWebhook(body)).duplicates).toBe(1);
    await processPendingEvents();
    await processPendingEvents();
    expect(await db.select().from(contacts)).toHaveLength(1);
    expect(await db.select().from(channelIdentities)).toHaveLength(1);
    expect(await db.select().from(relationshipEntries)).toHaveLength(0); // contato do Instagram ≠ Lead
    expect(await db.select().from(messages)).toHaveLength(1);
    const [c] = await db.select().from(contacts);
    expect(c).toMatchObject({ name: "Ana Souza", username: "anasouza", source: "instagram_dm" }); // perfil oficial
    const [conv] = await db.select().from(conversations);
    expect(conv.unreadCount).toBe(1);
  });

  it("deduplica pelo identificador oficial, nunca pelo nome", async () => {
    const { ctx } = await setupOrg();
    await connect(ctx.admin);
    await createContact(ctx.admin, { name: "Ana Souza", username: "anasouza" }); // mesmo nome/@ manual
    await ingestWebhook(dm("mid.1", "igsid-ana", "Oi"));
    await ingestWebhook(dm("mid.2", "igsid-ana", "Tudo bem?"));
    await processPendingEvents();
    expect(await db.select().from(contacts)).toHaveLength(2); // não mescla automaticamente por nome
    expect(await db.select().from(channelIdentities)).toHaveLength(1);
    expect(await db.select().from(messages)).toHaveLength(2);
  });

  it("tolera eventos fora de ordem", async () => {
    const { ctx } = await setupOrg();
    await connect(ctx.admin);
    const t = Date.now();
    await ingestWebhook(dm("mid.2", "igsid-x", "segunda", t));
    await ingestWebhook(dm("mid.1", "igsid-x", "primeira", t - 60_000));
    await processPendingEvents();
    const [conv] = await db.select().from(conversations);
    expect(conv.lastMessagePreview).toBe("segunda");
    const data = await getConversation(ctx.admin, conv.id, { limit: 40 });
    expect(data.messages.map((m) => m.body)).toEqual(["primeira", "segunda"]);
  });

  it("separa payload com mensagens e comentários", () => {
    const evs = splitPayload({
      object: "instagram",
      entry: [{ id: IG, messaging: [{ sender: { id: "a" }, recipient: { id: IG }, message: { mid: "m" } }], changes: [{ field: "comments", value: { id: "c1", text: "oi" } }] }],
    });
    expect(evs.map((e) => e.key)).toEqual([`comment:${IG}:c1`, `messages:${IG}:m`]);
  });
});

describe("Envio de Direct", () => {
  async function withConversation() {
    const s = await setupOrg();
    await connect(s.ctx.admin);
    await ingestWebhook(dm("mid.in.1", "igsid-ana", "Oi!"));
    await processPendingEvents();
    const [conv] = await db.select().from(conversations);
    return { ...s, conv };
  }

  it("envio idempotente: o mesmo clique/retry nunca gera duas mensagens", async () => {
    const { ctx, conv } = await withConversation();
    const id = randomUUID();
    const a = await sendMessage(ctx.admin, conv.id, { text: "Olá, Ana!", clientRequestId: id });
    const b = await sendMessage(ctx.admin, conv.id, { text: "Olá, Ana!", clientRequestId: id });
    expect(a.id).toBe(b.id);
    expect(a.status).toBe("accepted");
    expect(api.count("sendText")).toBe(1);
  });

  it("eco do webhook da mensagem enviada não duplica", async () => {
    const { ctx, conv } = await withConversation();
    const m = await sendMessage(ctx.admin, conv.id, { text: "Resposta", clientRequestId: randomUUID() });
    await ingestWebhook(dm(m.externalId!, "igsid-ana", "Resposta", Date.now(), true));
    await processPendingEvents();
    expect(await db.select().from(messages).where(eq(messages.direction, "out"))).toHaveLength(1);
  });

  it("timeout vira 'não confirmada' e exige reconciliação antes do reenvio", async () => {
    const { ctx, conv } = await withConversation();
    api.sendBehavior = "timeout";
    const m = await sendMessage(ctx.admin, conv.id, { text: "Vai?", clientRequestId: randomUUID() });
    expect(m.status).toBe("unconfirmed");
    await expect(resendMessage(ctx.admin, m.id, randomUUID())).rejects.toMatchObject({ code: "conflict" });
    // Reconciliação encontra a mensagem no provedor → aceita, sem reenviar
    api.providerMessages = [{ id: "mid.found", text: "Vai?", createdTime: new Date().toISOString(), fromId: IG }];
    const r = await reconcileMessage(ctx.admin, m.id);
    expect(r).toEqual({ status: "accepted", found: true });
    expect(api.count("sendText")).toBe(1);
  });

  it("não encontrada na reconciliação → reenvio seguro com nova tentativa", async () => {
    const { ctx, conv } = await withConversation();
    api.sendBehavior = "timeout";
    const m = await sendMessage(ctx.admin, conv.id, { text: "Teste", clientRequestId: randomUUID() });
    api.providerMessages = [];
    expect((await reconcileMessage(ctx.admin, m.id)).found).toBe(false);
    api.sendBehavior = "ok";
    const again = await resendMessage(ctx.admin, m.id, randomUUID());
    expect(again.status).toBe("accepted");
    expect(api.count("sendText")).toBe(2);
  });

  it("eco reconcilia automaticamente envio não confirmado", async () => {
    const { ctx, conv } = await withConversation();
    api.sendBehavior = "timeout";
    const m = await sendMessage(ctx.admin, conv.id, { text: "Eco?", clientRequestId: randomUUID() });
    await ingestWebhook(dm("mid.echo.1", "igsid-ana", "Eco?", Date.now(), true));
    await processPendingEvents();
    const [row] = await db.select().from(messages).where(eq(messages.id, m.id));
    expect(row).toMatchObject({ status: "accepted", externalId: "mid.echo.1" });
    expect(await db.select().from(messages).where(eq(messages.direction, "out"))).toHaveLength(1);
  });

  it("falha definitiva aparece como falha, sem sucesso falso; erro de credencial pede reconexão", async () => {
    const { ctx, conv } = await withConversation();
    api.sendBehavior = "window";
    const m = await sendMessage(ctx.admin, conv.id, { text: "x", clientRequestId: randomUUID() });
    expect(m.status).toBe("failed");
    expect(m.error).toMatch(/janela/);
    api.sendBehavior = "auth";
    await sendMessage(ctx.admin, conv.id, { text: "y", clientRequestId: randomUUID() });
    const [acc] = await db.select().from(connectedAccounts);
    expect(acc.status).toBe("reconnect_required");
    const data = await getConversation(ctx.admin, conv.id, { limit: 40 });
    expect(data.send).toMatchObject({ allowed: false, code: "reconnect" });
  });

  it("fora da janela de 24 h o envio é bloqueado no servidor", async () => {
    const { ctx, conv } = await withConversation();
    await db.update(conversations).set({ lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) }).where(eq(conversations.id, conv.id));
    await expect(sendMessage(ctx.admin, conv.id, { text: "oi", clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "channel_unavailable", details: { code: "window" } });
    expect(api.count("sendText")).toBe(0);
  });

  it("contato manual sem identidade oficial não ganha envio fictício de DM", async () => {
    const { ctx, org } = await setupOrg();
    await connect(ctx.admin);
    const [acc] = await db.select().from(connectedAccounts);
    const c = await createContact(ctx.admin, { name: "Manual", username: "@manual" });
    const [conv] = await db.insert(conversations).values({ orgId: org.id, contactId: c.id, accountId: acc.id, channel: "instagram", lastInboundAt: new Date() }).returning();
    await expect(sendMessage(ctx.admin, conv.id, { text: "oi", clientRequestId: randomUUID() })).rejects.toMatchObject({ details: { code: "no_identity" } });
    expect(api.count("sendText")).toBe(0);
  });

  it("seller não envia em conversa de outro seller", async () => {
    const { ctx, conv } = await withConversation();
    await expect(sendMessage(ctx.seller, conv.id, { text: "oi", clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("Comentários", () => {
  async function withComment(commentedAt = Math.floor(Date.now() / 1000)) {
    const s = await setupOrg();
    await connect(s.ctx.admin);
    const body = JSON.stringify({
      object: "instagram",
      entry: [{ id: IG, changes: [{ field: "comments", value: { id: "c.1", text: "Quero saber mais", from: { id: "igsid-julia", username: "juliaalves" }, media: { id: "media.1", media_product_type: "FEED" }, timestamp: commentedAt } }] }],
    });
    await ingestWebhook(body);
    await ingestWebhook(body); // reentrega
    await processPendingEvents();
    const [comment] = await db.select().from(socialComments);
    return { ...s, comment };
  }

  it("reentrega não duplica comentário; por padrão não cria contato automaticamente", async () => {
    const { ctx } = await withComment();
    expect(await db.select().from(socialComments)).toHaveLength(1);
    expect(await db.select().from(contacts)).toHaveLength(0);
    const list = await listComments(ctx.admin, { status: "all", limit: 30 });
    expect(list.rows[0].actions).toMatchObject({ publicReply: true, privateReply: true });
  });

  it("resposta pública e privada são separadas; privada só uma vez", async () => {
    const { ctx, comment } = await withComment();
    const pub = await replyToComment(ctx.admin, comment.id, { kind: "public", text: "Obrigado!", clientRequestId: randomUUID() });
    expect(pub.status).toBe("accepted");
    expect(api.count("replyToComment")).toBe(1);
    const priv = await replyToComment(ctx.admin, comment.id, { kind: "private", text: "Te chamei no Direct", clientRequestId: randomUUID() });
    expect(priv.status).toBe("accepted");
    await expect(replyToComment(ctx.admin, comment.id, { kind: "private", text: "De novo", clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "conflict" });
    expect(api.count("sendPrivateReply")).toBe(1);
    const list = await listComments(ctx.admin, { status: "all", limit: 30 });
    expect(list.rows[0].actions.privateReply).toBe(false);
  });

  it("resposta privada indisponível após 7 dias", async () => {
    const { ctx, comment } = await withComment(Math.floor((Date.now() - 8 * 86400 * 1000) / 1000));
    await expect(replyToComment(ctx.admin, comment.id, { kind: "private", text: "oi", clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "channel_unavailable" });
    expect(api.count("sendPrivateReply")).toBe(0);
  });

  it("organização demo nunca envia externamente", async () => {
    const { ctx, comment } = await withComment();
    const demoCtx = { ...ctx.admin, org: { ...ctx.admin.org, isDemo: true } };
    await expect(replyToComment(demoCtx, comment.id, { kind: "public", text: "x", clientRequestId: randomUUID() })).rejects.toMatchObject({ code: "channel_unavailable" });
    expect(api.count("replyToComment")).toBe(0);
  });
});


