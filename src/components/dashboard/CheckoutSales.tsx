"use client";

import Link from "next/link";
import useSWR from "swr";
import { Info, ReceiptText, ShoppingBag, Undo2 } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { fetcher } from "@/lib/api";
import { useOpenContact } from "@/lib/nav";
import { formatBRL, formatDateTime, relativeTime } from "@/lib/format";
import { Badge, Card, EmptyState, LoadingState } from "@/components/ui";
import { CountUp } from "@/components/motion/CountUp";

type Sale = {
  id: string;
  contactId: string | null;
  name: string | null;
  email: string | null;
  product: string | null;
  offerType: string | null;
  amountCents: number;
  paymentMethod: string | null;
  sourceVia: "utm" | "crm" | null;
  utmSource: string | null;
  utmCampaign: string | null;
  paidAt: string;
  source: { id: string; name: string; color: string } | null;
};
type Data = {
  connected: boolean;
  lastEventAt: string | null;
  totals: { sales: number; revenueCents: number; avgTicketCents: number; refunds: number; refundedCents: number };
  origins: { sourceId: string | null; name: string; color: string; sales: number; revenueCents: number; share: number }[];
  products: { name: string; sales: number; revenueCents: number }[];
  recent: Sale[];
};

const PAY: Record<string, string> = { pix: "Pix", credit_card: "Cartão", boleto: "Boleto", picpay: "PicPay", applepay: "Apple Pay", googlepay: "Google Pay", openfinance_nubank: "Nubank" };
const OFFER: Record<string, string> = { upsell: "Upsell", downsell: "Downsell", orderbump: "Order bump" };
const brlCount = (n: number) => formatBRL(Math.round(n), true);

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[16px] bg-page/70 p-4">
      <p className="flex items-center gap-2 text-[13px] text-muted [&>svg]:size-4">
        {icon}
        {label}
      </p>
      <p className="mt-1 truncate text-[22px] sm:text-[26px] font-bold leading-tight tracking-tight text-[#0f1f1a]">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
    </div>
  );
}

function Origin({ s }: { s: Sale }) {
  if (!s.source && !s.utmSource) return <span className="text-muted">Sem origem</span>;
  const how = s.sourceVia === "utm" ? "pelo link do checkout" : s.sourceVia === "crm" ? "origem que o CRM já conhecia" : "UTM sem origem cadastrada";
  return (
    <span className="inline-flex min-w-0 flex-col">
      <span className="inline-flex items-center gap-1.5">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--stage-${s.source?.color ?? "gray"}-dot)` }} aria-hidden />
        <span className="truncate">{s.source?.name ?? s.utmSource}</span>
      </span>
      <span className="truncate text-[11.5px] text-muted" title={how}>
        {[s.utmSource && `utm ${s.utmSource}`, s.utmCampaign].filter(Boolean).join(" · ") || how}
      </span>
    </span>
  );
}

/** Vendas pagas na Cakto (webhook): valor, origem e comprador. Só gestores veem. */
export function CheckoutSales({ query, isAdmin }: { query: string; isAdmin: boolean }) {
  const { data, error } = useSWR<Data>(`/api/dashboard/checkout${query}`, fetcher, { keepPreviousData: true });
  const openContact = useOpenContact();
  if (error) return null;
  if (!data) return <LoadingState rows={2} />;
  if (!data.connected && !data.totals.sales) {
    if (!isAdmin) return null;
    return (
      <Card className="p-5 sm:p-6">
        <EmptyState
          icon={<ShoppingBag />}
          title="Conecte a Cakto para ver as vendas aqui"
          description="Cada venda aprovada entra sozinha no Dashboard com o valor pago, o produto, o comprador e de onde ele veio."
          action={
            <Link href="/integracoes#cakto" className="inline-flex h-11 items-center rounded-[14px] bg-brand px-4 text-[14px] font-semibold text-white">
              Conectar a Cakto
            </Link>
          }
          className="py-4"
        />
      </Card>
    );
  }
  const t = data.totals;
  const maxRev = Math.max(1, ...data.origins.map((o) => o.revenueCents));
  return (
    <Card className="p-5 sm:p-7 anim-rise">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-[14px] bg-selected text-brand" aria-hidden>
            <ShoppingBag className="size-5" />
          </span>
          <div>
            <h2 className="text-[17px] sm:text-[19px] font-semibold leading-tight">Vendas na Cakto</h2>
            <p className="text-[13px] text-muted">Entram sozinhas a cada pagamento aprovado{data.lastEventAt ? ` · último aviso ${relativeTime(data.lastEventAt).toLowerCase()}` : ""}.</p>
          </div>
        </div>
        <Popover.Root>
          <Popover.Trigger asChild>
            <button className="inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink" aria-label="Como a origem é definida">
              <Info className="size-4" />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content sideOffset={6} className="z-50 max-w-[300px] rounded-[14px] border border-line bg-white p-3 text-[13px] leading-relaxed text-muted shadow-[var(--shadow-pop)]">
              A origem vem do link do checkout (utm_source, sck). Use o mesmo nome das origens do CRM, como <b>stories</b>, <b>whatsapp</b> ou <b>trafego</b>. Sem UTM, vale a origem que o CRM já conhecia do comprador. Valores pelo dia do pagamento; reembolsos e chargebacks saem do total.
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={<ReceiptText />} label="Faturado na Cakto" value={<CountUp value={t.revenueCents} format={brlCount} duration={1200} />} sub="Valor pago pelos compradores" />
        <Stat icon={<ShoppingBag />} label="Vendas pagas" value={<CountUp value={t.sales} />} />
        <Stat icon={<ReceiptText />} label="Ticket médio" value={formatBRL(t.avgTicketCents, true)} />
        <Stat icon={<Undo2 />} label="Reembolsos e chargebacks" value={t.refunds} sub={t.refunds ? formatBRL(t.refundedCents, true) : undefined} />
      </div>

      {t.sales === 0 ? (
        <p className="mt-5 rounded-[14px] bg-page/70 px-4 py-3 text-[13.5px] text-muted">Nenhuma venda paga no período.</p>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <div className="min-w-0">
            <h3 className="mb-3 text-[14px] font-semibold">De onde vieram</h3>
            <ul className="flex flex-col gap-3">
              {data.origins.map((o, i) => (
                <li key={o.sourceId ?? "none"} className="anim-fade text-[14px]" style={{ "--i": i } as React.CSSProperties}>
                  <div className="flex items-center gap-2">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--stage-${o.color}-dot)` }} aria-hidden />
                    <span className="flex-1 truncate">{o.name}</span>
                    <span className="text-[12.5px] text-muted">
                      {o.sales} venda{o.sales === 1 ? "" : "s"}
                    </span>
                    <b className="w-24 text-right font-semibold tabular-nums">{formatBRL(o.revenueCents, true)}</b>
                  </div>
                  <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-[#eef3f1]" aria-hidden>
                    <span className="bar-grow block h-full rounded-full" style={{ width: `${(o.revenueCents / maxRev) * 100}%`, background: `var(--stage-${o.color}-dot)`, "--i": i } as React.CSSProperties} />
                  </span>
                </li>
              ))}
            </ul>
            {data.products.length > 1 && (
              <>
                <h3 className="mb-2 mt-5 text-[14px] font-semibold">Por produto</h3>
                <ul className="flex flex-col gap-1.5 text-[13.5px]">
                  {data.products.map((p) => (
                    <li key={p.name} className="flex items-center gap-2">
                      <span className="flex-1 truncate">{p.name}</span>
                      <span className="text-muted">{p.sales}</span>
                      <b className="w-24 text-right font-semibold tabular-nums">{formatBRL(p.revenueCents, true)}</b>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div className="min-w-0">
            <h3 className="mb-2 text-[14px] font-semibold">Últimas vendas</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-[13.5px]">
                <thead>
                  <tr className="border-b border-line text-[12px] text-muted">
                    <th className="py-2 font-medium">Comprador</th>
                    <th className="py-2 font-medium">Produto</th>
                    <th className="py-2 font-medium">Origem</th>
                    <th className="py-2 text-right font-medium">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((s, i) => (
                    <tr key={s.id} className="anim-fade border-b border-line align-top last:border-0" style={{ "--i": i } as React.CSSProperties}>
                      <td className="max-w-[180px] py-2.5 pr-2">
                        {s.contactId ? (
                          <button className="block max-w-full truncate text-left font-medium hover:text-brand hover:underline" onClick={() => openContact(s.contactId!)}>
                            {s.name ?? s.email ?? "Comprador"}
                          </button>
                        ) : (
                          <span className="block truncate font-medium">{s.name ?? s.email ?? "Comprador"}</span>
                        )}
                        <span className="block text-[11.5px] text-muted" title={formatDateTime(s.paidAt)}>
                          {relativeTime(s.paidAt)}
                        </span>
                      </td>
                      <td className="max-w-[160px] py-2.5 pr-2">
                        <span className="block truncate">{s.product ?? "—"}</span>
                        <span className="block text-[11.5px] text-muted">{[s.paymentMethod ? (PAY[s.paymentMethod] ?? s.paymentMethod) : null, s.offerType ? OFFER[s.offerType] : null].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="max-w-[170px] py-2.5 pr-2">
                        <Origin s={s} />
                      </td>
                      <td className="py-2.5 text-right font-semibold tabular-nums">{formatBRL(s.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {t.sales > data.recent.length && <Badge className="mt-2">Mostrando as {data.recent.length} mais recentes</Badge>}
          </div>
        </div>
      )}
    </Card>
  );
}
