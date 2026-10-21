/**
 * Cakto: leitura dos pedidos (webhook e API pública) e validação da assinatura.
 * Documentação: https://docs.cakto.com.br/conceitos/webhooks e /api-reference/orders/list
 */
import { hmacSha256Hex, safeEqual } from "../../crypto";

export type CaktoOrder = {
  externalId: string;
  refId: string | null;
  status: string;
  customer: { name: string | null; email: string | null; phone: string | null };
  product: { id: string | null; name: string | null };
  offerName: string | null;
  offerType: string | null;
  amountCents: number;
  baseAmountCents: number | null;
  feesCents: number | null;
  currency: string;
  paymentMethod: string | null;
  installments: number | null;
  utm: Record<string, string>;
  orderedAt: Date | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  chargedbackAt: Date | null;
  canceledAt: Date | null;
};

/** Rastreamento que a Cakto repassa do link do checkout. */
export const TRACKING_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "sck", "src"] as const;

/** Status do pedido quando o envio não traz `status` (usa o nome do evento). */
const EVENT_STATUS: Record<string, string> = {
  purchase_approved: "paid",
  subscription_renewed: "paid",
  purchase_refused: "refused",
  subscription_renewal_refused: "refused",
  refund: "refunded",
  refund_requested: "refund_requested",
  chargeback: "chargedback",
  pix_gerado: "waiting_payment",
  boleto_gerado: "waiting_payment",
  picpay_gerado: "waiting_payment",
  openfinance_nubank_gerado: "waiting_payment",
};

/** Status que contam como venda paga no Dashboard. */
export const PAID_STATUSES = ["paid", "authorized"];

/**
 * Ordem dos status: um reenvio atrasado de "compra aprovada" não desfaz um reembolso.
 * Status desconhecidos ficam no meio (aceitos, sem regredir um estado final).
 */
export function statusRank(s: string) {
  if (["waiting_payment", "processing", "scheduled", "retrying", "partially_paid"].includes(s)) return 0;
  if (["refused", "acquirer_error", "blocked"].includes(s)) return 1;
  if (["paid", "authorized", "in_settlement"].includes(s)) return 2;
  if (["refund_requested", "prechargeback", "in_protest", "MED"].includes(s)) return 3;
  if (["refunded", "chargedback", "canceled"].includes(s)) return 4;
  return 2;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function str(v: unknown, max = 300): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.replace(/\u0000/g, "").trim();
  return t ? t.slice(0, max) : null;
}

/** Valores chegam como número (webhook) ou texto decimal "997.00" (API). */
export function toCents(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v * 100);
  if (typeof v !== "string" || !v.trim()) return null;
  let t = v.trim().replace(/[^\d.,-]/g, "");
  if (t.includes(",") && !t.includes(".")) t = t.replace(",", ".");
  else if (t.includes(",") && t.includes(".")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

function date(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** UTMs dos campos do pedido; o que faltar vem da query do link do checkout. */
function tracking(d: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of TRACKING_KEYS) {
    const v = str(d[k]);
    if (v) out[k] = v;
  }
  const url = str(d.checkoutUrl, 2000) ?? str(d.checkoutURL, 2000);
  if (url) {
    try {
      const q = new URL(url).searchParams;
      for (const k of TRACKING_KEYS) {
        const v = str(q.get(k));
        if (v && !out[k]) out[k] = v;
      }
    } catch {
      /* link inválido: ignora */
    }
  }
  return out;
}

/** Converte um pedido da Cakto (objeto `data` do webhook ou item da API) no formato do CRM. */
export function parseOrder(raw: unknown, event?: string | null): CaktoOrder | null {
  const d = obj(raw);
  if (!d) return null;
  const externalId = str(d.id, 120);
  if (!externalId) return null;
  const c = obj(d.customer) ?? {};
  const p = obj(d.product) ?? {};
  const o = obj(d.offer) ?? {};
  const amount = toCents(d.amount) ?? toCents(o.price) ?? toCents(d.baseAmount) ?? 0;
  const statusFromEvent = event ? EVENT_STATUS[event] : undefined;
  return {
    externalId,
    refId: str(d.refId, 60),
    status: str(d.status, 40) ?? statusFromEvent ?? "unknown",
    customer: { name: str(c.name, 200), email: str(c.email, 200)?.toLowerCase() ?? null, phone: str(c.phone, 40) },
    product: { id: str(p.id, 120), name: str(p.name, 200) },
    offerName: str(o.name, 200),
    offerType: str(d.offer_type, 40),
    amountCents: amount,
    baseAmountCents: toCents(d.baseAmount),
    feesCents: toCents(d.fees),
    currency: str(d.currency, 10) ?? str(o.currency, 10) ?? str(p.currency, 10) ?? "BRL",
    paymentMethod: str(d.paymentMethod, 40),
    installments: typeof d.installments === "number" ? d.installments : Number(d.installments) || null,
    utm: tracking(d),
    orderedAt: date(d.createdAt),
    paidAt: date(d.paidAt),
    refundedAt: date(d.refundedAt),
    chargedbackAt: date(d.chargedbackAt),
    canceledAt: date(d.canceledAt),
  };
}

export type CaktoEnvelope = { secret: string | null; event: string | null; orders: unknown[] };

/** Corpo do webhook: { secret, event, data } — na versão 2, `data` é uma lista. */
export function parseEnvelope(body: unknown): CaktoEnvelope {
  const b = obj(body) ?? {};
  const data = b.data;
  return { secret: str(b.secret, 300), event: str(b.event, 80), orders: Array.isArray(data) ? data : data ? [data] : [] };
}

/**
 * Validação do envio. Preferência: cabeçalho X-Cakto-Signature (v1 = HMAC-SHA256 de "{timestamp}.{corpo}")
 * com no máximo 5 minutos de diferença; sem cabeçalho, o campo `secret` do corpo.
 */
export function verifyCakto(secret: string, raw: string, bodySecret: string | null, headers: Headers, now = Date.now()): { ok: boolean; reason?: string } {
  const sig = headers.get("x-cakto-signature");
  const ts = headers.get("x-cakto-timestamp");
  if (sig && ts) {
    const t = Number(ts);
    const v1 = sig
      .split(",")
      .map((x) => x.trim())
      .find((x) => x.startsWith("v1="))
      ?.slice(3);
    if (v1 && Number.isFinite(t) && Math.abs(now / 1000 - t) <= 300 && safeEqual(v1, hmacSha256Hex(secret, `${ts}.${raw}`))) return { ok: true };
  }
  if (bodySecret && safeEqual(bodySecret, secret)) return { ok: true };
  return { ok: false, reason: sig ? "Assinatura da Cakto não confere (ou o envio tem mais de 5 minutos)." : "Segredo do webhook não confere." };
}
