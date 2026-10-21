/**
 * Vendas da Cakto: cada pedido chega pelo webhook (ou pela importação da API), é ligado ao contato
 * do CRM e recebe a origem (UTM do checkout ou a origem já conhecida da pessoa).
 * CONFIGURAÇÃO: somente administradores. DASHBOARD: administradores e gestores.
 */
import { and, desc, eq, gte, inArray, isNull, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import { checkoutIntegrations, checkoutOrders, contactTouchpoints, contacts, integrationLogs, leadSources, memberships, quizForms } from "../db/schema";
import type { Ctx } from "../context";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../crypto";
import { appUrl } from "../env";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { assertCan, can } from "../permissions";
import { publish } from "../realtime";
import { logger } from "../logger";
import { audit, notifyUser } from "./common";
import { findContact, normalizeEmail, normalizePhone } from "./leads";
import { resolvePeriod, type commercialDashboardSchema } from "./metrics";
import { PAID_STATUSES, parseEnvelope, parseOrder, statusRank, verifyCakto, type CaktoOrder } from "../integrations/cakto/parse";

const PROVIDER = "cakto";
const NAME = "Cakto";
const API = "https://api.cakto.com.br";
const ADMIN_ONLY = "Somente administradores configuram a Cakto.";
/** Pedido que deixou de valer (não entra no faturamento). */
const UNDONE = ["refunded", "chargedback", "canceled"];

type Row = typeof checkoutIntegrations.$inferSelect;

const dec = (v: string | null) => {
  if (!v) return null;
  try {
    return decryptSecret(v);
  } catch {
    return null;
  }
};

/** Painel primeiro; variáveis de ambiente do Render como alternativa. */
const webhookSecretOf = (r: Row) => dec(r.webhookSecretEnc) ?? (process.env.CAKTO_WEBHOOK_SECRET || null);
const apiCredsOf = (r: Row) => {
  const clientId = dec(r.apiClientIdEnc) ?? (process.env.CAKTO_CLIENT_ID || null);
  const clientSecret = dec(r.apiClientSecretEnc) ?? (process.env.CAKTO_CLIENT_SECRET || null);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
};

async function ensureIntegration(orgId: string): Promise<Row> {
  const [row] = await db.select().from(checkoutIntegrations).where(and(eq(checkoutIntegrations.orgId, orgId), eq(checkoutIntegrations.provider, PROVIDER)));
  if (row) return row;
  const token = randomToken(24);
  await db.insert(checkoutIntegrations).values({ orgId, provider: PROVIDER, tokenHash: sha256(token), tokenEnc: encryptSecret(token) }).onConflictDoNothing();
  const [created] = await db.select().from(checkoutIntegrations).where(and(eq(checkoutIntegrations.orgId, orgId), eq(checkoutIntegrations.provider, PROVIDER)));
  return created;
}

async function log(r: Pick<Row, "id" | "orgId">, event: string, result: "success" | "error", message: string, tx: DbOrTx = db) {
  await tx.insert(integrationLogs).values({ orgId: r.orgId, integrationId: r.id, integrationName: NAME, event, result, message: message.slice(0, 500) });
}

async function recordError(r: Row, event: string, message: string) {
  await db.update(checkoutIntegrations).set({ lastError: message.slice(0, 300), lastErrorAt: new Date() }).where(eq(checkoutIntegrations.id, r.id));
  await log(r, event, "error", message);
}

// ---------- Configuração ----------

export async function caktoSetup(ctx: Ctx) {
  assertCan(ctx, "integrations.manage", ADMIN_ONLY);
  const r = await ensureIntegration(ctx.orgId);
  const [counts] = await db
    .select({ n: sql<number>`count(*)::int`, paid: sql<number>`count(*) filter (where ${checkoutOrders.paidAt} is not null)::int` })
    .from(checkoutOrders)
    .where(and(eq(checkoutOrders.orgId, ctx.orgId), eq(checkoutOrders.provider, PROVIDER)));
  const token = dec(r.tokenEnc);
  return {
    webhookUrl: token ? `${appUrl()}/api/webhooks/cakto/${token}` : null,
    webhookSecret: r.webhookSecretEnc ? "panel" : process.env.CAKTO_WEBHOOK_SECRET ? "env" : "missing",
    api: r.apiClientIdEnc && r.apiClientSecretEnc ? "panel" : process.env.CAKTO_CLIENT_ID && process.env.CAKTO_CLIENT_SECRET ? "env" : "missing",
    lastEventAt: r.lastEventAt,
    lastImportAt: r.lastImportAt,
    lastError: r.lastError,
    lastErrorAt: r.lastErrorAt,
    orders: counts?.n ?? 0,
    paidOrders: counts?.paid ?? 0,
  };
}

export const caktoSettingsSchema = z.object({
  webhookSecret: z.string().trim().max(300).optional(),
  clientId: z.string().trim().max(300).optional(),
  clientSecret: z.string().trim().max(300).optional(),
  clear: z.enum(["webhookSecret", "api"]).optional(),
});

export async function saveCaktoSettings(ctx: Ctx, input: z.infer<typeof caktoSettingsSchema>) {
  assertCan(ctx, "integrations.manage", ADMIN_ONLY);
  const r = await ensureIntegration(ctx.orgId);
  const patch: Partial<typeof checkoutIntegrations.$inferInsert> = { updatedAt: new Date() };
  if (input.clear === "webhookSecret") patch.webhookSecretEnc = null;
  if (input.clear === "api") Object.assign(patch, { apiClientIdEnc: null, apiClientSecretEnc: null });
  if (input.webhookSecret) {
    if (input.webhookSecret.length < 8) throw invalid("Segredo curto demais.", { webhookSecret: "Cole o segredo completo do webhook." });
    patch.webhookSecretEnc = encryptSecret(input.webhookSecret);
  }
  if (input.clientId || input.clientSecret) {
    if (!input.clientId) throw invalid("Informe o Client ID.", { clientId: "Informe o Client ID." });
    if (!input.clientSecret && !r.apiClientSecretEnc) throw invalid("Informe o Client Secret.", { clientSecret: "Informe o Client Secret." });
    patch.apiClientIdEnc = encryptSecret(input.clientId);
    if (input.clientSecret) patch.apiClientSecretEnc = encryptSecret(input.clientSecret);
  }
  await db.update(checkoutIntegrations).set(patch).where(eq(checkoutIntegrations.id, r.id));
  await audit(db, ctx, "checkout.settings_saved", "checkout_integration", r.id, { provider: PROVIDER, webhookSecret: !!input.webhookSecret, api: !!input.clientId, clear: input.clear ?? null });
  return caktoSetup(ctx);
}

/** Novo endereço do webhook (o antigo para de funcionar) e segredo zerado para ser aprendido de novo. */
export async function regenerateCaktoUrl(ctx: Ctx) {
  assertCan(ctx, "integrations.manage", ADMIN_ONLY);
  const r = await ensureIntegration(ctx.orgId);
  const token = randomToken(24);
  await db.update(checkoutIntegrations).set({ tokenHash: sha256(token), tokenEnc: encryptSecret(token), webhookSecretEnc: null, updatedAt: new Date() }).where(eq(checkoutIntegrations.id, r.id));
  await audit(db, ctx, "checkout.url_regenerated", "checkout_integration", r.id);
  return caktoSetup(ctx);
}

// ---------- Origem ----------

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/** Apelidos comuns de utm_source → palavra que aparece no nome da origem do CRM. */
const ALIASES: Record<string, string[]> = {
  trafego: ["trafego", "trafego-pago", "ads", "paid", "pago", "cpc", "meta", "meta-ads", "facebook", "facebook-ads", "fb", "fb-ads", "ig-ads", "instagram-ads", "google-ads", "gads", "adwords"],
  stories: ["stories", "story", "storie", "ig-stories", "instagram-stories"],
  whatsapp: ["whatsapp", "wpp", "zap", "wa", "grupo", "grupo-whatsapp", "whats"],
  instagram: ["instagram", "ig", "bio", "link-bio", "linkinbio", "direct", "dm"],
  organico: ["organico", "conteudo-organico", "organic", "reels", "feed", "post"],
  indicacao: ["indicacao", "referral", "indique"],
  email: ["email", "e-mail", "newsletter"],
  youtube: ["youtube", "yt"],
};

type Src = { id: string; key: string; name: string };

export function matchSource(value: string, sources: Src[]): string | null {
  const v = slug(value);
  if (!v) return null;
  const exact = sources.find((s) => s.key === v || slug(s.name) === v || s.key.startsWith(`${v}-`));
  if (exact) return exact.id;
  const words = new Set([v]);
  for (const [word, list] of Object.entries(ALIASES)) if (list.includes(v)) words.add(word);
  for (const w of words) {
    if (w.length < 3) continue;
    const hit = sources.find((s) => slug(s.name).split("-").includes(w) || slug(s.name).startsWith(w) || s.key.startsWith(w));
    if (hit) return hit.id;
  }
  return null;
}

/** Origem do pedido: links de origem dos quizzes (mesmo utm_source) → nome/apelido da origem → nada. */
async function sourceFromTracking(tx: DbOrTx, orgId: string, utm: Record<string, string>) {
  const values = [utm.utm_source, utm.sck, utm.src].filter((x): x is string => !!x);
  if (!values.length) return null;
  const forms = await tx.select({ links: quizForms.links }).from(quizForms).where(eq(quizForms.orgId, orgId));
  for (const v of values) {
    const lv = v.toLowerCase();
    for (const f of forms) {
      const link = f.links.find((l) => l.sourceId && (l.utmSource?.toLowerCase() === lv || l.key.toLowerCase() === lv));
      if (link?.sourceId) return link.sourceId;
    }
  }
  const sources = await tx.select({ id: leadSources.id, key: leadSources.key, name: leadSources.name }).from(leadSources).where(and(eq(leadSources.orgId, orgId), isNull(leadSources.archivedAt)));
  for (const v of values) {
    const id = matchSource(v, sources);
    if (id) return id;
  }
  return null;
}

// ---------- Recebimento ----------

const fmtBRL = (cents: number, currency = "BRL") => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "BRL" });

/**
 * Grava (ou atualiza) um pedido. Idempotente pelo id do pedido na Cakto: reenvios não duplicam
 * e um status mais antigo não desfaz um mais novo (ex.: aprovação atrasada depois do reembolso).
 */
export async function ingestCaktoOrder(r: Pick<Row, "id" | "orgId">, order: CaktoOrder, opts: { event?: string | null; notify?: boolean } = {}) {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const inserted = await tx.insert(checkoutOrders).values({ orgId: r.orgId, provider: PROVIDER, externalId: order.externalId, status: order.status }).onConflictDoNothing().returning({ id: checkoutOrders.id });
    const fresh = inserted.length > 0;
    const [cur] = await tx
      .select()
      .from(checkoutOrders)
      .where(and(eq(checkoutOrders.orgId, r.orgId), eq(checkoutOrders.provider, PROVIDER), eq(checkoutOrders.externalId, order.externalId)))
      .for("update");
    const advance = fresh || statusRank(order.status) >= statusRank(cur.status);
    const status = advance ? order.status : cur.status;
    // Pago: aprovado, ou em reembolso solicitado/contestação (o dinheiro ainda não voltou).
    const isPaid = PAID_STATUSES.includes(status) || (!UNDONE.includes(status) && statusRank(status) >= 2 && !!(order.paidAt ?? cur.paidAt));
    const becamePaid = isPaid && !cur.paidAt;

    // Pessoa: procura por e-mail/telefone; comprador novo vira contato quando o pagamento é confirmado.
    const email = normalizeEmail(order.customer.email);
    const phone = normalizePhone(order.customer.phone);
    let contactId = cur.contactId;
    let contact = contactId ? (await tx.select().from(contacts).where(eq(contacts.id, contactId)))[0] ?? null : null;
    if (!contact && (email || phone)) contact = await findContact(tx, r.orgId, { email, phone, instagram: null });

    // Origem: a do link do checkout; sem UTM, a que o CRM já conhecia da pessoa.
    let sourceId = cur.sourceVia === "utm" ? cur.sourceId : await sourceFromTracking(tx, r.orgId, order.utm);
    let sourceVia: string | null = sourceId ? "utm" : null;
    if (!sourceId && contact) {
      sourceId = contact.lastSourceId ?? contact.firstSourceId ?? null;
      sourceVia = sourceId ? "crm" : null;
    }

    if (!contact && isPaid && (email || phone)) {
      [contact] = await tx
        .insert(contacts)
        .values({
          orgId: r.orgId,
          name: order.customer.name ?? email ?? phone ?? "Comprador Cakto",
          email,
          phone,
          source: "checkout",
          summary: `Comprou na Cakto${order.product.name ? ` · ${order.product.name}` : ""}`,
          lastInteractionAt: now,
          firstSourceId: sourceId,
          firstTouchAt: sourceId ? now : null,
          lastSourceId: sourceId,
          lastTouchAt: sourceId ? now : null,
        })
        .returning();
    }
    contactId = contact?.id ?? null;

    const [saved] = await tx
      .update(checkoutOrders)
      .set({
        refId: order.refId ?? cur.refId,
        status,
        lastEvent: opts.event ?? cur.lastEvent ?? "import",
        contactId,
        customerName: order.customer.name ?? cur.customerName,
        customerEmail: email ?? cur.customerEmail,
        customerPhone: phone ?? cur.customerPhone,
        productExternalId: order.product.id ?? cur.productExternalId,
        productName: order.product.name ?? cur.productName,
        offerName: order.offerName ?? cur.offerName,
        offerType: order.offerType ?? cur.offerType,
        amountCents: order.amountCents || cur.amountCents,
        baseAmountCents: order.baseAmountCents ?? cur.baseAmountCents,
        feesCents: order.feesCents ?? cur.feesCents,
        currency: order.currency,
        paymentMethod: order.paymentMethod ?? cur.paymentMethod,
        installments: order.installments ?? cur.installments,
        utm: { ...cur.utm, ...order.utm },
        sourceId,
        sourceVia,
        campaign: order.utm.utm_campaign ?? cur.campaign,
        orderedAt: order.orderedAt ?? cur.orderedAt,
        paidAt: order.paidAt ?? cur.paidAt ?? (becamePaid ? now : null),
        refundedAt: order.refundedAt ?? cur.refundedAt ?? (status === "refunded" && cur.status !== "refunded" ? now : null),
        chargedbackAt: order.chargedbackAt ?? cur.chargedbackAt ?? (status === "chargedback" && cur.status !== "chargedback" ? now : null),
        canceledAt: order.canceledAt ?? cur.canceledAt,
        updatedAt: now,
      })
      .where(eq(checkoutOrders.id, cur.id))
      .returning();

    if (contact && becamePaid) {
      // Jornada: a compra aparece na linha do tempo do contato com a origem e o valor.
      const patch: Partial<typeof contacts.$inferInsert> = { lastInteractionAt: now, updatedAt: now };
      if (!contact.email && email) patch.email = email;
      if (!contact.phone && phone) patch.phone = phone;
      if (sourceVia === "utm" && sourceId) {
        if (!contact.firstSourceId) {
          patch.firstSourceId = sourceId;
          patch.firstTouchAt = now;
        }
        patch.lastSourceId = sourceId;
        patch.lastTouchAt = now;
      }
      await tx.update(contacts).set(patch).where(eq(contacts.id, contact.id));
      await tx.insert(contactTouchpoints).values({
        orgId: r.orgId,
        contactId: contact.id,
        sourceId,
        kind: "purchase",
        campaign: saved.campaign,
        channel: order.utm.utm_medium ?? null,
        adName: order.utm.utm_content ?? null,
        integrationId: r.id,
        integrationName: NAME,
        utm: saved.utm,
        note: `Comprou “${saved.productName ?? "produto"}” na Cakto · ${fmtBRL(saved.amountCents, saved.currency)}`,
        occurredAt: saved.paidAt ?? now,
      });
    }
    await tx.update(checkoutIntegrations).set({ lastEventAt: now, lastError: null, lastErrorAt: null }).where(eq(checkoutIntegrations.id, r.id));
    return { saved, becamePaid, created: fresh, sourceVia };
  });

  const { saved, becamePaid } = result;
  if (becamePaid && opts.notify !== false) {
    const [src] = saved.sourceId ? await db.select({ name: leadSources.name }).from(leadSources).where(eq(leadSources.id, saved.sourceId)) : [];
    const managers = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.orgId, r.orgId), inArray(memberships.role, ["admin", "manager"]), eq(memberships.status, "active")));
    const body = [saved.productName, fmtBRL(saved.amountCents, saved.currency), src?.name ?? saved.utm.utm_source ?? null].filter(Boolean).join(" · ");
    for (const m of managers) {
      await notifyUser({
        orgId: r.orgId,
        userId: m.userId,
        type: "checkout.sale",
        title: `Nova venda na Cakto: ${saved.customerName ?? "comprador"}`,
        body,
        link: saved.contactId ? `/contatos?contato=${saved.contactId}` : "/dashboard",
        dedupeKey: `cakto:${saved.externalId}:paid`,
      }).catch((e) => logger.warn("Falha ao avisar venda da Cakto", e));
    }
  }
  await publish({ orgId: r.orgId, topic: "sales", entityId: saved.id, managersOnly: true });
  if (saved.contactId) await publish({ orgId: r.orgId, topic: "contacts", entityId: saved.contactId, managersOnly: true });
  return result;
}

/** Endpoint público do webhook: o token do endereço identifica a organização; o segredo valida o envio. */
export async function receiveCaktoWebhook(token: string, raw: string, headers: Headers) {
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(token)) throw notFound("Endereço inválido.");
  const [r] = await db.select().from(checkoutIntegrations).where(eq(checkoutIntegrations.tokenHash, sha256(token)));
  if (!r) throw notFound("Endereço inválido.");
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    await recordError(r, "Envio recusado", "O corpo não é JSON.");
    throw invalid("Envie JSON.");
  }
  const env = parseEnvelope(body);
  const secret = webhookSecretOf(r);
  if (secret) {
    const v = verifyCakto(secret, raw, env.secret, headers);
    if (!v.ok) {
      await recordError(r, "Envio recusado", v.reason ?? "Segredo inválido.");
      throw new AppError("forbidden", v.reason ?? "Segredo inválido.");
    }
  } else if (env.secret) {
    // Primeiro envio: o endereço é secreto, então guardamos o segredo da Cakto e exigimos dali em diante.
    await db.update(checkoutIntegrations).set({ webhookSecretEnc: encryptSecret(env.secret), updatedAt: new Date() }).where(eq(checkoutIntegrations.id, r.id));
    await log(r, "Segredo salvo", "success", "Primeiro envio da Cakto: o segredo do webhook foi guardado (criptografado) e passa a ser exigido.");
  }
  if (env.event === "checkout_abandonment") {
    await log(r, "Abandono de checkout", "success", "Evento de abandono recebido e ignorado (só vendas entram no Dashboard).");
    return { ok: true, ignored: true };
  }
  let n = 0;
  for (const raw of env.orders) {
    const order = parseOrder(raw, env.event);
    if (!order) continue;
    // "Enviar teste" da Cakto usa dados fictícios (example.com, domínio reservado): confirma a conexão sem criar venda.
    if (order.customer.email && /@example\.(com|org|net)$/.test(order.customer.email)) {
      await db.update(checkoutIntegrations).set({ lastEventAt: new Date(), lastError: null, lastErrorAt: null }).where(eq(checkoutIntegrations.id, r.id));
      await log(r, "Envio de teste", "success", "Teste da Cakto recebido: conexão funcionando. Nenhuma venda foi criada.");
      return { ok: true, test: true };
    }
    const res = await ingestCaktoOrder(r, order, { event: env.event });
    n++;
    const who = res.saved.customerName ?? res.saved.customerEmail ?? "comprador";
    await log(
      r,
      env.event ?? "Pedido",
      "success",
      `${who} · ${res.saved.productName ?? "produto"} · ${fmtBRL(res.saved.amountCents, res.saved.currency)} · status ${res.saved.status}${res.sourceVia === "utm" ? " · origem pela UTM" : res.sourceVia === "crm" ? " · origem do contato" : ""}`,
    );
  }
  if (!n) await log(r, env.event ?? "Envio", "success", "Envio recebido sem pedido reconhecível (sem data.id); nada foi alterado.");
  return { ok: true, orders: n };
}

// ---------- Importação pela API (vendas antigas) ----------

type Fetch = typeof fetch;
let fetchImpl: Fetch | null = null;
/** Somente testes. */
export function setCaktoFetchForTests(f: Fetch | null) {
  fetchImpl = f;
}
const doFetch: Fetch = (input, init) => (fetchImpl ?? fetch)(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20000) });

async function apiToken(creds: { clientId: string; clientSecret: string }) {
  const res = await doFetch(`${API}/public_api/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: creds.clientId, client_secret: creds.clientSecret }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (res.status === 401 || data.error === "invalid_client") throw invalid("A Cakto recusou o Client ID/Secret. Confira a chave em Integrações → Cakto API.");
  if (!res.ok || !data.access_token) throw new AppError("provider_error", `A Cakto não liberou o acesso (HTTP ${res.status}).`);
  return data.access_token;
}

export const importSchema = z.object({ days: z.coerce.number().int().min(1).max(365).default(90) });

export async function importCaktoOrders(ctx: Ctx, input: z.infer<typeof importSchema>) {
  assertCan(ctx, "integrations.manage", ADMIN_ONLY);
  const r = await ensureIntegration(ctx.orgId);
  const creds = apiCredsOf(r);
  if (!creds) throw invalid("Salve o Client ID e o Client Secret da Cakto antes de importar.");
  try {
    const token = await apiToken(creds);
    const since = new Date(Date.now() - input.days * 86400000).toISOString().slice(0, 10);
    let page = 1;
    let imported = 0;
    let paid = 0;
    for (; page <= 50; page++) {
      const q = new URLSearchParams({ paidAt__gte: since, ordering: "paidAt", limit: "100", page: String(page) });
      const res = await doFetch(`${API}/public_api/orders/?${q}`, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403 || res.status === 400) throw invalid("A chave da Cakto precisa do escopo de leitura de pedidos (orders).");
      if (!res.ok) throw new AppError("provider_error", `A Cakto respondeu HTTP ${res.status} ao listar pedidos.`);
      const data = (await res.json()) as { results?: unknown[]; next?: string | null };
      for (const item of data.results ?? []) {
        const order = parseOrder(item);
        if (!order) continue;
        const out = await ingestCaktoOrder(r, order, { notify: false });
        imported++;
        if (out.saved.paidAt) paid++;
      }
      if (!data.next) break;
    }
    await db.update(checkoutIntegrations).set({ lastImportAt: new Date() }).where(eq(checkoutIntegrations.id, r.id));
    await log(r, "Importação", "success", `${imported} pedido(s) dos últimos ${input.days} dias conferidos (${paid} pagos).`);
    await audit(db, ctx, "checkout.imported", "checkout_integration", r.id, { imported, days: input.days });
    return { imported, paid };
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Não foi possível falar com a Cakto agora. Tente de novo em alguns minutos.";
    if (!(e instanceof AppError)) logger.warn("Falha ao importar pedidos da Cakto", e);
    await recordError(r, "Importação", msg);
    throw e instanceof AppError ? e : new AppError("provider_error", msg);
  }
}

// ---------- Dashboard ----------

type Filters = z.infer<typeof commercialDashboardSchema>;

/** Vendas da Cakto no período (pela data do pagamento): total, origem, produto e as últimas vendas. */
export async function checkoutDashboard(ctx: Ctx, f: Filters) {
  if (!can(ctx, "data.all")) throw forbidden();
  const { start, end } = resolvePeriod(f, ctx.org.timezone);
  const [conn] = await db.select({ id: checkoutIntegrations.id, lastEventAt: checkoutIntegrations.lastEventAt }).from(checkoutIntegrations).where(eq(checkoutIntegrations.orgId, ctx.orgId));
  const base: SQL[] = [eq(checkoutOrders.orgId, ctx.orgId)];
  if (f.sourceId) base.push(eq(checkoutOrders.sourceId, f.sourceId));
  if (f.campaign) base.push(eq(checkoutOrders.campaign, f.campaign));
  const paidConds = [...base, gte(checkoutOrders.paidAt, start), lt(checkoutOrders.paidAt, end), notInArray(checkoutOrders.status, UNDONE)];
  const undoneAt = sql`coalesce(${checkoutOrders.refundedAt}, ${checkoutOrders.chargedbackAt}, ${checkoutOrders.canceledAt})`;

  const [[tot], [lost], byOrigin, byProduct, recent, sources] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${checkoutOrders.amountCents}), 0)::bigint` }).from(checkoutOrders).where(and(...paidConds)),
    db
      .select({ n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${checkoutOrders.amountCents}), 0)::bigint` })
      .from(checkoutOrders)
      .where(and(...base, inArray(checkoutOrders.status, UNDONE), sql`${undoneAt} >= ${start.toISOString()}::timestamptz`, sql`${undoneAt} < ${end.toISOString()}::timestamptz`)),
    db
      .select({ sourceId: checkoutOrders.sourceId, n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${checkoutOrders.amountCents}), 0)::bigint` })
      .from(checkoutOrders)
      .where(and(...paidConds))
      .groupBy(checkoutOrders.sourceId),
    db
      .select({ name: sql<string>`coalesce(${checkoutOrders.productName}, 'Sem nome')`, n: sql<number>`count(*)::int`, cents: sql<number>`coalesce(sum(${checkoutOrders.amountCents}), 0)::bigint` })
      .from(checkoutOrders)
      .where(and(...paidConds))
      .groupBy(sql`1`)
      .orderBy(sql`3 desc`)
      .limit(8),
    db
      .select({
        id: checkoutOrders.id,
        contactId: checkoutOrders.contactId,
        name: checkoutOrders.customerName,
        email: checkoutOrders.customerEmail,
        product: checkoutOrders.productName,
        offerType: checkoutOrders.offerType,
        amountCents: checkoutOrders.amountCents,
        currency: checkoutOrders.currency,
        paymentMethod: checkoutOrders.paymentMethod,
        sourceId: checkoutOrders.sourceId,
        sourceVia: checkoutOrders.sourceVia,
        utmSource: sql<string | null>`${checkoutOrders.utm}->>'utm_source'`,
        utmCampaign: checkoutOrders.campaign,
        paidAt: checkoutOrders.paidAt,
      })
      .from(checkoutOrders)
      .where(and(...paidConds))
      .orderBy(desc(checkoutOrders.paidAt))
      .limit(12),
    db.select({ id: leadSources.id, name: leadSources.name, color: leadSources.color }).from(leadSources).where(eq(leadSources.orgId, ctx.orgId)),
  ]);
  const src = (id: string | null) => sources.find((s) => s.id === id) ?? null;
  const total = Number(tot?.cents ?? 0);
  return {
    connected: !!conn,
    lastEventAt: conn?.lastEventAt ?? null,
    totals: { sales: tot?.n ?? 0, revenueCents: total, avgTicketCents: tot?.n ? Math.round(total / tot.n) : 0, refunds: lost?.n ?? 0, refundedCents: Number(lost?.cents ?? 0) },
    origins: byOrigin
      .map((o) => ({ sourceId: o.sourceId, name: src(o.sourceId)?.name ?? "Sem origem identificada", color: src(o.sourceId)?.color ?? "gray", sales: o.n, revenueCents: Number(o.cents), share: total ? Math.round((Number(o.cents) / total) * 1000) / 10 : 0 }))
      .sort((a, b) => b.revenueCents - a.revenueCents),
    products: byProduct.map((p) => ({ name: p.name, sales: p.n, revenueCents: Number(p.cents) })),
    recent: recent.map((x) => ({ ...x, source: src(x.sourceId) })),
  };
}
