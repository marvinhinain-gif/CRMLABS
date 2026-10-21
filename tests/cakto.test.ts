import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { checkoutOrders, contactTouchpoints, contacts, notifications } from "@/server/db/schema";
import { catalog, createSource } from "@/server/services/integrations";
import { caktoSetup, checkoutDashboard, importCaktoOrders, matchSource, receiveCaktoWebhook, saveCaktoSettings, setCaktoFetchForTests } from "@/server/services/checkout";
import { parseOrder, toCents } from "@/server/integrations/cakto/parse";
import { setupOrg } from "./helpers";

const SECRET = "b3f1a9c2-7b4d-4a8e-9f01-2c6d5b8a4e37";
const tokenOf = (url: string) => url.split("/").pop()!;

/** Exemplo da documentação da Cakto (purchase_approved), com UTMs. */
function sale(over: Record<string, unknown> = {}, event = "purchase_approved", secret = SECRET) {
  return {
    secret,
    event,
    data: {
      id: "b3df956e-1998-4322-b091-ac0c54f7b4ba",
      refId: "4852F91",
      status: "paid",
      offer_type: "main",
      checkoutUrl: "https://pay.cakto.com.br/a8BcHrY?utm_source=stories&utm_campaign=lancamento",
      baseAmount: 997.0,
      amount: 997.0,
      currency: "BRL",
      fees: 49.9,
      discount: "0.00",
      installments: 1,
      paymentMethod: "pix",
      customer: { id: 481920, name: "João Comprador", email: "Joao@Comprador.com.br", phone: "5571999990000", docType: "cpf", docNumber: "12345678909" },
      product: { id: "cd287b31-d4b7-4e94-858a-96e05ce2f4a2", short_id: "42bruPi", name: "Mentoria AXION", type: "unique" },
      offer: { id: "a8BcHrY", name: "Oferta principal", price: 997.0, currency: "BRL" },
      utm_source: null,
      utm_campaign: null,
      createdAt: "2026-10-20T16:01:53.935243-03:00",
      paidAt: new Date().toISOString(),
      ...over,
    },
  };
}

async function setup() {
  const o = await setupOrg();
  const cat = await catalog(o.ctx.admin);
  const src = (k: string) => cat.sources.find((s) => s.key === k)!.id;
  const setup = await caktoSetup(o.ctx.admin);
  const token = tokenOf(setup.webhookUrl!);
  const send = (body: unknown, headers: Record<string, string> = {}) => {
    const raw = JSON.stringify(body);
    return receiveCaktoWebhook(token, raw, new Headers({ "content-type": "application/json", ...headers }));
  };
  return { ...o, src, token, send };
}

describe("Cakto: leitura dos pedidos", () => {
  it("converte valores em número e em texto decimal", () => {
    expect(toCents(997)).toBe(99700);
    expect(toCents("1497.50")).toBe(149750);
    expect(toCents("1.497,50")).toBe(149750);
    expect(toCents(null)).toBeNull();
  });

  it("lê UTMs dos campos e, na falta, do link do checkout", () => {
    const o = parseOrder(sale().data)!;
    expect(o.utm).toEqual({ utm_source: "stories", utm_campaign: "lancamento" });
    expect(o.amountCents).toBe(99700);
    expect(o.customer.email).toBe("joao@comprador.com.br");
    const o2 = parseOrder({ ...sale().data, utm_source: "fb", sck: "anuncio-7" })!;
    expect(o2.utm.utm_source).toBe("fb");
    expect(o2.utm.sck).toBe("anuncio-7");
  });

  it("reconhece a origem por nome, chave e apelidos", () => {
    const sources = [
      { id: "1", key: "trafego-pago", name: "Tráfego Pago" },
      { id: "2", key: "stories", name: "Stories" },
      { id: "3", key: "whatsapp-ab1", name: "Grupo de WhatsApp" },
    ];
    expect(matchSource("Stories", sources)).toBe("2");
    expect(matchSource("fb", sources)).toBe("1");
    expect(matchSource("facebook_ads", sources)).toBe("1");
    expect(matchSource("wpp", sources)).toBe("3");
    expect(matchSource("whatsapp", sources)).toBe("3");
    expect(matchSource("tiktok", sources)).toBeNull();
  });
});

describe("Cakto: webhook de vendas", () => {
  it("somente administradores configuram", async () => {
    const { ctx } = await setupOrg();
    for (const who of [ctx.manager, ctx.seller, ctx.closer]) {
      await expect(caktoSetup(who)).rejects.toMatchObject({ code: "forbidden" });
      await expect(saveCaktoSettings(who, { webhookSecret: SECRET })).rejects.toMatchObject({ code: "forbidden" });
    }
  });

  it("venda aprovada cria o contato com a origem da UTM, avisa gestores e aparece no Dashboard", async () => {
    const { org, ctx, src, send, users: u } = await setup();
    const res = await send(sale());
    expect(res).toMatchObject({ ok: true, orders: 1 });

    const [o] = await db.select().from(checkoutOrders).where(eq(checkoutOrders.orgId, org.id));
    expect(o).toMatchObject({ status: "paid", amountCents: 99700, productName: "Mentoria AXION", sourceId: src("stories"), sourceVia: "utm", campaign: "lancamento", customerEmail: "joao@comprador.com.br" });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, o.contactId!));
    expect(c).toMatchObject({ name: "João Comprador", source: "checkout", email: "joao@comprador.com.br", phone: "+5571999990000", firstSourceId: src("stories") });
    const tps = await db.select().from(contactTouchpoints).where(eq(contactTouchpoints.contactId, c.id));
    expect(tps).toHaveLength(1);
    expect(tps[0]).toMatchObject({ kind: "purchase", integrationName: "Cakto" });
    expect(tps[0].note).toContain("Mentoria AXION");

    // Gestores recebem a notificação; social seller não.
    const notes = await db.select().from(notifications).where(eq(notifications.type, "checkout.sale"));
    expect(notes.map((n) => n.userId).sort()).toEqual([u.admin.id, u.manager.id].sort());

    // Primeiro envio ensinou o segredo: agora ele é exigido.
    expect((await caktoSetup(ctx.admin)).webhookSecret).toBe("panel");
    await expect(send(sale({}, "purchase_approved", "segredo-errado-123"))).rejects.toMatchObject({ code: "forbidden" });

    const d = await checkoutDashboard(ctx.manager, { period: "month" });
    expect(d.totals).toMatchObject({ sales: 1, revenueCents: 99700, avgTicketCents: 99700 });
    expect(d.origins[0]).toMatchObject({ name: "Stories", sales: 1, share: 100 });
    expect(d.recent[0]).toMatchObject({ name: "João Comprador", product: "Mentoria AXION", amountCents: 99700, sourceVia: "utm" });
    await expect(checkoutDashboard(ctx.seller, { period: "month" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("assinatura no cabeçalho (HMAC) vale; envio repetido não duplica", async () => {
    const { org, ctx, send } = await setup();
    await saveCaktoSettings(ctx.admin, { webhookSecret: SECRET });
    const body = sale({}, "purchase_approved", "nao-vem-no-corpo");
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = `v1=${createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex")}`;
    await expect(send(body, { "x-cakto-signature": sig, "x-cakto-timestamp": ts })).resolves.toMatchObject({ ok: true });
    // Assinatura velha (mais de 5 minutos) é recusada.
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const oldSig = `v1=${createHmac("sha256", SECRET).update(`${old}.${raw}`).digest("hex")}`;
    await expect(send(body, { "x-cakto-signature": oldSig, "x-cakto-timestamp": old })).rejects.toMatchObject({ code: "forbidden" });
    // Reenvio com o segredo no corpo: mesmo pedido, sem nova jornada nem nova notificação.
    await send(sale());
    const orders = await db.select().from(checkoutOrders).where(eq(checkoutOrders.orgId, org.id));
    expect(orders).toHaveLength(1);
    expect(await db.select().from(contactTouchpoints).where(eq(contactTouchpoints.orgId, org.id))).toHaveLength(1);
  });

  it("comprador que já está no CRM herda a origem do contato quando o checkout não tem UTM", async () => {
    const { org, ctx, src, send } = await setup();
    const [c] = await db.insert(contacts).values({ orgId: org.id, name: "Maria", email: "maria@ex.com", firstSourceId: src("collab"), lastSourceId: src("collab") }).returning();
    await send(sale({ id: "pedido-2", checkoutUrl: "https://pay.cakto.com.br/x", customer: { name: "Maria S.", email: "MARIA@ex.com", phone: null } }));
    const [o] = await db.select().from(checkoutOrders).where(eq(checkoutOrders.externalId, "pedido-2"));
    expect(o).toMatchObject({ contactId: c.id, sourceId: src("collab"), sourceVia: "crm" });
    expect((await db.select().from(contacts).where(eq(contacts.orgId, org.id))).length).toBe(1);
    const d = await checkoutDashboard(ctx.admin, { period: "month" });
    expect(d.origins[0].name).toBe("Collab");
  });

  it("reembolso tira do faturamento e aprovação atrasada não desfaz o reembolso", async () => {
    const { org, ctx, send } = await setup();
    await send(sale());
    await send(sale({ status: "refunded", refundedAt: new Date().toISOString() }, "refund"));
    await send(sale());
    const [o] = await db.select().from(checkoutOrders).where(eq(checkoutOrders.orgId, org.id));
    expect(o.status).toBe("refunded");
    const d = await checkoutDashboard(ctx.admin, { period: "month" });
    expect(d.totals).toMatchObject({ sales: 0, revenueCents: 0, refunds: 1, refundedCents: 99700 });
  });

  it("Pix gerado não conta como venda nem cria contato; abandono é ignorado", async () => {
    const { org, send } = await setup();
    await send(sale({ id: "pix-1", status: "waiting_payment", paidAt: null }, "pix_gerado"));
    await expect(send({ secret: SECRET, event: "checkout_abandonment", data: { customerEmail: "a@b.com" } })).resolves.toMatchObject({ ignored: true });
    const [o] = await db.select().from(checkoutOrders).where(and(eq(checkoutOrders.orgId, org.id), eq(checkoutOrders.externalId, "pix-1")));
    expect(o).toMatchObject({ status: "waiting_payment", paidAt: null, contactId: null });
    expect(await db.select().from(contacts).where(eq(contacts.orgId, org.id))).toHaveLength(0);
  });

  it("envio de teste da Cakto (example.com) confirma a conexão sem criar venda", async () => {
    const { org, ctx, send } = await setup();
    await expect(send(sale({ customer: { name: "John Doe", email: "john.doe@example.com" } }))).resolves.toMatchObject({ ok: true, test: true });
    expect(await db.select().from(checkoutOrders).where(eq(checkoutOrders.orgId, org.id))).toHaveLength(0);
    const s = await caktoSetup(ctx.admin);
    expect(s.lastEventAt).not.toBeNull();
    expect(s.webhookSecret).toBe("panel");
  });

  it("endereço desconhecido é recusado", async () => {
    await expect(receiveCaktoWebhook("x".repeat(32), "{}", new Headers())).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("Cakto: importar vendas antigas pela API", () => {
  it("usa Client ID/Secret salvos (criptografados) e pagina os pedidos", async () => {
    const { org, ctx } = await setupOrg();
    await createSource(ctx.admin, "Grupo de WhatsApp");
    await expect(importCaktoOrders(ctx.admin, { days: 30 })).rejects.toMatchObject({ code: "invalid" });
    await saveCaktoSettings(ctx.admin, { clientId: "cid", clientSecret: "csecret" });
    expect((await caktoSetup(ctx.admin)).api).toBe("panel");

    const calls: string[] = [];
    setCaktoFetchForTests(async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/public_api/token/")) {
        expect(String(init?.body)).toContain("client_id=cid");
        return new Response(JSON.stringify({ access_token: "jwt", expires_in: 36000, token_type: "Bearer" }), { status: 200 });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer jwt");
      const page = new URL(url).searchParams.get("page");
      const item = (id: string, src: string) => ({ id, refId: id, status: "paid", amount: "497.00", baseAmount: "497.00", paymentMethod: "credit_card", customer: { name: `Cliente ${id}`, email: `${id}@ex.com` }, product: { id: "p1", name: "Curso" }, utm_source: src, paidAt: new Date().toISOString() });
      return new Response(JSON.stringify(page === "1" ? { count: 2, next: "https://api.cakto.com.br/public_api/orders/?page=2", results: [item("a1", "wpp")] } : { count: 2, next: null, results: [item("a2", "fb")] }), { status: 200 });
    });
    try {
      await expect(importCaktoOrders(ctx.admin, { days: 30 })).resolves.toEqual({ imported: 2, paid: 2 });
    } finally {
      setCaktoFetchForTests(null);
    }
    expect(calls).toHaveLength(3);
    const d = await checkoutDashboard(ctx.admin, { period: "month" });
    expect(d.totals).toMatchObject({ sales: 2, revenueCents: 99400 });
    expect(d.origins.map((o) => o.name).sort()).toEqual(["Grupo de WhatsApp", "Tráfego Pago"]);
    // Importação não dispara notificação em massa.
    expect(await db.select().from(notifications).where(and(eq(notifications.orgId, org.id), eq(notifications.type, "checkout.sale")))).toHaveLength(0);
  });
});
