"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import { CalendarCheck, CalendarDays, ChevronDown, CircleDollarSign, Flag, Handshake, Info, MessagesSquare, Pencil, Plus, SlidersHorizontal, Target, Trophy, X } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import { formatBRL, parseBRLToCents } from "@/lib/format";
import { Button, Card, cx, DemoBadge, Dialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, PageHeader, Select } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { CountUp } from "@/components/motion/CountUp";
import { OpsSection } from "./OpsSection";

type Dash = {
  period: { key: string; start: string; end: string };
  scope: "org" | "seller" | "closer" | "manager" | "admin";
  meta: { month: string; targetCents: number; realizedCents: number; remainingCents: number; progress: number | null; sales: number; daysLeft: number; forecastCents: number | null; canEdit: boolean };
  kpis: { contacts: number; scheduled: number; done: number; noShow: number; sales: number; revenueCents: number; avgTicketCents: number; lost: number; forwarded: number };
  conversions: { contactToMeeting: number | null; meetingToShow: number | null; meetingToSale: number | null; contactToSale: number | null };
  closerRanking: { userId: string; name: string; sales: number; revenueCents: number; avgTicketCents: number }[];
  schedulerRanking: { userId: string; name: string; role: string | null; scheduled: number; done: number; sold: number }[];
  origins: { totalLeads: number; rows: { sourceId: string | null; name: string; color: string; leads: number; share: number; meetings: number; sales: number; revenueCents: number }[] };
};
type Options = { sellers: { id: string; name: string }[]; closers: { id: string; name: string }[]; products: { id: string; name: string }[]; sources: { id: string; name: string; color: string }[]; campaigns: string[] };

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "month", label: "Este mês" },
  { value: "last_month", label: "Mês anterior" },
  { value: "custom", label: "Personalizado" },
];

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthLabel = (key: string) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS[m - 1]} de ${y}`;
};
const pctLabel = (v: number | null) => (v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`);
const brlCount = (n: number) => formatBRL(Math.round(n), true);

function InfoTip({ children, label = "O que é isso?" }: { children: React.ReactNode; label?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="inline-flex size-7 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink" aria-label={label}>
          <Info className="size-4" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content sideOffset={6} className="z-50 max-w-[280px] rounded-[14px] border border-line bg-white p-3 text-[13px] leading-relaxed text-muted shadow-[var(--shadow-pop)]">
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Medal({ i }: { i: number }) {
  const m = ["🥇", "🥈", "🥉"][i];
  return m ? <span className="w-7 text-center text-[20px] leading-none">{m}</span> : <span className="w-7 text-center text-[13px] font-semibold text-muted">{i + 1}º</span>;
}

// ---------- Meta ----------
function GoalDialog({ open, onOpenChange, month }: { open: boolean; onOpenChange: (v: boolean) => void; month: string }) {
  const { mutate } = useSWRConfig();
  const { data } = useSWR<{ current: string; months: { month: string; targetCents: number }[] }>(open ? "/api/goals" : null, fetcher);
  const [sel, setSel] = useState(month);
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  const current = data?.months.find((m) => m.month === sel);
  const save = async () => {
    const cents = parseBRLToCents(value);
    if (cents === null || cents <= 0) return setErr("Informe um valor maior que zero.");
    setBusy(true);
    try {
      await api.put("/api/goals", { month: sel, targetCents: cents });
      toast.success(`Meta de ${monthLabel(sel)} salva.`);
      mutate((k) => typeof k === "string" && (k.startsWith("/api/dashboard") || k.startsWith("/api/goals")));
      onOpenChange(false);
      setValue("");
    } catch (e) {
      setErr((e as ApiError).fields?.targetCents ?? (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Meta Comercial"
      description="Meta de faturamento da equipe no mês. O realizado vem das vendas ganhas registradas no CRM."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} loading={busy} disabled={!value}>
            Salvar meta
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Mês" htmlFor="goal-month">
          <Select id="goal-month" value={sel} onChange={(e) => setSel(e.target.value)}>
            {(data?.months ?? [{ month, targetCents: 0 }]).map((m) => (
              <option key={m.month} value={m.month}>
                {monthLabel(m.month)}
                {m.targetCents ? ` · atual ${formatBRL(m.targetCents, true)}` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Meta de faturamento (R$)" htmlFor="goal-value" error={err} hint={current?.targetCents ? `Hoje: ${formatBRL(current.targetCents)}` : undefined}>
          <Input id="goal-value" inputMode="decimal" autoFocus value={value} onChange={(e) => (setValue(e.target.value), setErr(undefined))} placeholder="300.000,00" />
        </Field>
      </div>
    </Dialog>
  );
}

function MetaCard({ meta }: { meta: Dash["meta"] }) {
  const [edit, setEdit] = useState(false);
  const progress = meta.progress ?? 0;
  const hit = progress >= 100;
  return (
    <Card className="relative overflow-hidden p-5 sm:p-7 anim-rise" style={{ "--i": 0 } as React.CSSProperties}>
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-[260px] rounded-full bg-selected/70" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="anim-pop flex size-12 items-center justify-center rounded-[16px] bg-brand text-white" aria-hidden>
            <Target className="size-6" />
          </span>
          <div>
            <h2 className="text-[19px] sm:text-[21px] font-semibold leading-tight">Meta Comercial</h2>
            <p className="text-[13px] text-muted">
              Mês de <b className="font-semibold text-ink">{monthLabel(meta.month)}</b>
              {meta.daysLeft > 0 && ` · faltam ${meta.daysLeft} dia${meta.daysLeft > 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
        {meta.canEdit && (
          <Button size="sm" variant="secondary" icon={meta.targetCents ? <Pencil className="size-4" /> : <Plus className="size-4" />} onClick={() => setEdit(true)}>
            {meta.targetCents ? "Editar meta" : "Definir meta"}
          </Button>
        )}
      </div>

      {meta.targetCents ? (
        <>
          <div className="relative mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-[13px] text-muted">Realizado</p>
              <p className="text-[24px] sm:text-[30px] font-bold leading-tight tracking-tight text-brand-dark">
                <CountUp value={meta.realizedCents} format={brlCount} duration={1400} />
              </p>
            </div>
            <div>
              <p className="text-[13px] text-muted">Meta</p>
              <p className="text-[20px] sm:text-[24px] font-semibold leading-tight">{formatBRL(meta.targetCents, true)}</p>
            </div>
            <div>
              <p className="text-[13px] text-muted">{hit ? "Acima da meta" : "Restante"}</p>
              <p className="text-[20px] sm:text-[24px] font-semibold leading-tight">{hit ? formatBRL(meta.realizedCents - meta.targetCents, true) : formatBRL(meta.remainingCents, true)}</p>
            </div>
            <div>
              <p className="text-[13px] text-muted">Progresso</p>
              <p className={cx("text-[20px] sm:text-[24px] font-semibold leading-tight", hit && "text-brand")}>
                <CountUp value={progress} format={(n) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: n % 1 ? 1 : 0 })}%`} duration={1400} />
              </p>
            </div>
          </div>
          <div className="relative mt-5 h-4 sm:h-5 overflow-hidden rounded-full bg-[#e9f1ee]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)} aria-label="Progresso da meta">
            <span className="bar-grow bar-shine block h-full rounded-full bg-gradient-to-r from-[#00a878] to-[#008a65]" style={{ width: `${Math.min(100, Math.max(progress, progress > 0 ? 2 : 0))}%` }} />
          </div>
          <p className="relative mt-2.5 text-[12.5px] text-muted">
            {meta.sales} venda{meta.sales === 1 ? "" : "s"} no mês
            {meta.forecastCents !== null && !hit && <> · no ritmo atual, o mês fecha em <b className="font-semibold text-ink">{formatBRL(meta.forecastCents, true)}</b></>}
            {hit && " · meta batida! 🎉"}
          </p>
        </>
      ) : (
        <div className="relative mt-5 rounded-[16px] border border-dashed border-line bg-page/60 px-4 py-4 text-[14px]">
          <p className="font-medium">
            Realizado no mês: <CountUp value={meta.realizedCents} format={brlCount} />
          </p>
          <p className="text-[13px] text-muted">{meta.canEdit ? "Defina a meta de faturamento para acompanhar o progresso da equipe." : "O administrador ainda não definiu a meta deste mês."}</p>
        </div>
      )}
      {meta.canEdit && <GoalDialog open={edit} onOpenChange={setEdit} month={meta.month} />}
    </Card>
  );
}

// ---------- Indicadores ----------
function Kpi({ icon, label, value, sub, tip, i, href }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; tip?: string; i: number; href?: string }) {
  const body = (
    <Card className="lift h-full p-4 sm:p-5">
      <div className="flex items-start justify-between gap-2">
        <span className="anim-pop flex size-10 sm:size-11 items-center justify-center rounded-[14px] bg-selected text-brand [&>svg]:size-5" style={{ "--i": i } as React.CSSProperties} aria-hidden>
          {icon}
        </span>
        {tip && <InfoTip>{tip}</InfoTip>}
      </div>
      <p className="mt-3 text-[13px] sm:text-[14px] font-medium text-ink">{label}</p>
      <p className="mt-0.5 truncate text-[24px] sm:text-[28px] font-bold leading-tight tracking-tight text-[#0f1f1a]">{value}</p>
      {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
    </Card>
  );
  return (
    <div className="anim-rise min-w-0" style={{ "--i": i + 1 } as React.CSSProperties}>
      {href ? (
        <Link href={href} className="block h-full">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

// ---------- Conversões ----------
function Conversions({ k, c }: { k: Dash["kpis"]; c: Dash["conversions"] }) {
  const steps = [
    { label: "Contato → Agendamento", from: `${k.contacts} contato${k.contacts === 1 ? "" : "s"}`, to: `${k.scheduled} reuniõ${k.scheduled === 1 ? "ão" : "es"} agendada${k.scheduled === 1 ? "" : "s"}`, v: c.contactToMeeting, word: "de conversão", tip: "Reuniões agendadas ÷ contatos realizados no período." },
    { label: "Reunião → Comparecimento", from: `${k.scheduled} agendamento${k.scheduled === 1 ? "" : "s"}`, to: `${k.done} realizada${k.done === 1 ? "" : "s"}`, v: c.meetingToShow, word: "de comparecimento", tip: "Reuniões realizadas ÷ reuniões agendadas no período." },
    { label: "Reunião → Venda", from: `${k.done} realizada${k.done === 1 ? "" : "s"}`, to: `${k.sales} venda${k.sales === 1 ? "" : "s"}`, v: c.meetingToSale, word: "de fechamento", tip: "Vendas ganhas ÷ reuniões realizadas no período." },
  ];
  return (
    <Card className="p-5 sm:p-7 anim-rise" style={{ "--i": 7 } as React.CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[18px] sm:text-[20px] font-semibold">Conversões</h2>
          <p className="text-[12.5px] text-muted">Calculadas a partir dos eventos registrados no período</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-selected px-3.5 py-1.5 text-[13px]">
          <span className="text-brand-dark">Contato → Venda</span>
          <b className="text-[15px] text-brand">{pctLabel(c.contactToSale)}</b>
          <InfoTip>Vendas ÷ contatos realizados: a eficiência do funil inteiro.</InfoTip>
        </div>
      </div>
      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.label} className="anim-fade rounded-[18px] border border-line p-4" style={{ "--i": i + 8 } as React.CSSProperties}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13.5px] font-semibold">{s.label}</p>
              <InfoTip>{s.tip}</InfoTip>
            </div>
            <p className="mt-1 text-[12.5px] text-muted">
              {s.from} → {s.to}
            </p>
            <p className="mt-2 text-[26px] font-bold leading-none tracking-tight text-[#0f1f1a]">
              {s.v === null ? "—" : <CountUp value={s.v} format={(n) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`} delay={i * 120} />}
              <span className="ml-1.5 text-[12.5px] font-medium tracking-normal text-muted">{s.word}</span>
            </p>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[#eef3f1]" aria-hidden>
              <span className="bar-grow block h-full rounded-full bg-brand-accent" style={{ width: `${Math.min(100, s.v ?? 0)}%`, "--i": i } as React.CSSProperties} />
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------- Rankings ----------
function SalesRanking({ rows }: { rows: Dash["closerRanking"] }) {
  const max = Math.max(1, ...rows.map((r) => r.revenueCents));
  return (
    <Card className="p-5 sm:p-7 anim-rise" style={{ "--i": 9 } as React.CSSProperties}>
      <div className="flex items-center gap-2">
        <Trophy className="size-5 text-[#e0a106]" aria-hidden />
        <h2 className="text-[18px] sm:text-[20px] font-semibold">Ranking Comercial</h2>
      </div>
      <p className="text-[12.5px] text-muted">Quem mais vendeu no período</p>
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma venda no período" description="As vendas ganhas no Comercial aparecem aqui." className="py-6" />
      ) : (
        <ul className="mt-4 flex flex-col gap-3.5">
          {rows.slice(0, 8).map((r, i) => (
            <li key={r.userId} className="anim-fade" style={{ "--i": i + 10 } as React.CSSProperties}>
              <div className="flex items-center gap-3">
                <Medal i={i} />
                <TeamAvatar userId={r.userId} name={r.name} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[15px] font-semibold">{r.name}</p>
                    <p className="shrink-0 text-[15px] font-bold">{formatBRL(r.revenueCents, true)}</p>
                  </div>
                  <p className="text-[12.5px] text-muted">
                    {r.sales} venda{r.sales === 1 ? "" : "s"} · ticket médio {formatBRL(r.avgTicketCents, true)}
                  </p>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#eef3f1]" aria-hidden>
                    <span className="bar-grow block h-full rounded-full bg-brand" style={{ width: `${(r.revenueCents / max) * 100}%`, "--i": i } as React.CSSProperties} />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SchedulerRanking({ rows }: { rows: Dash["schedulerRanking"] }) {
  return (
    <Card className="p-5 sm:p-7 anim-rise" style={{ "--i": 10 } as React.CSSProperties}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CalendarCheck className="size-5 text-brand" aria-hidden />
          <h2 className="text-[18px] sm:text-[20px] font-semibold">Quem mais agendou reuniões</h2>
        </div>
        <InfoTip>De cada reunião agendada no período: quantas aconteceram (marcadas como realizadas) e quantas viraram venda depois.</InfoTip>
      </div>
      <p className="text-[12.5px] text-muted">Agendadas · aconteceram · viraram venda</p>
      {rows.length === 0 ? (
        <EmptyState title="Nenhuma reunião agendada no período" className="py-6" />
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-line">
          {rows.slice(0, 8).map((r, i) => (
            <li key={r.userId} className="anim-fade flex items-center gap-3 py-3 first:pt-0" style={{ "--i": i + 10 } as React.CSSProperties}>
              <Medal i={i} />
              <TeamAvatar userId={r.userId} name={r.name} size={36} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">{r.name}</p>
                <p className="text-[12px] text-muted">{r.role === "seller" ? "Social seller" : r.role === "closer" ? "Closer" : r.role === "admin" ? "Administrador" : "Gestor"}</p>
              </div>
              <div className="grid grid-cols-3 gap-1 text-center">
                {[
                  { n: r.scheduled, l: "agend." },
                  { n: r.done, l: "aconteceram" },
                  { n: r.sold, l: "vendas" },
                ].map((x, j) => (
                  <div key={x.l} className={cx("min-w-[52px] rounded-[12px] px-2 py-1", j === 0 ? "bg-selected" : "bg-page")}>
                    <p className={cx("text-[16px] font-bold leading-tight", j === 0 && "text-brand-dark")}>{x.n}</p>
                    <p className="text-[10.5px] text-muted">{x.l}</p>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- Origem ----------
function Origins({ o }: { o: Dash["origins"] }) {
  const [view, setView] = useState<"leads" | "money">("leads");
  const maxRev = Math.max(1, ...o.rows.map((r) => r.revenueCents));
  return (
    <Card className="p-5 sm:p-7 anim-rise" style={{ "--i": 11 } as React.CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[18px] sm:text-[20px] font-semibold">Origem dos Leads</h2>
          <p className="text-[12.5px] text-muted">{o.totalLeads} lead{o.totalLeads === 1 ? "" : "s"} no período · pela primeira origem do contato</p>
        </div>
        <div className="inline-flex rounded-[12px] bg-page p-1 text-[13px]" role="tablist" aria-label="Visualização">
          {(
            [
              ["leads", "Leads"],
              ["money", "Leads → Vendas"],
            ] as const
          ).map(([v, l]) => (
            <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cx("rounded-[9px] px-3 py-1.5 font-medium", view === v ? "bg-white shadow-sm text-ink" : "text-muted")}>
              {l}
            </button>
          ))}
        </div>
      </div>
      {o.rows.length === 0 ? (
        <EmptyState title="Nenhum lead com origem no período" description="Leads das integrações e origens registradas no contato aparecem aqui." className="py-6" />
      ) : view === "leads" ? (
        <>
          <div className="mt-5 flex h-4 w-full gap-[2px] overflow-hidden rounded-full" aria-hidden>
            {o.rows
              .filter((r) => r.leads)
              .map((r, i) => (
                <span key={r.sourceId ?? "none"} className="bar-grow h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${r.share}%`, background: `var(--stage-${r.color}-dot)`, "--i": i } as React.CSSProperties} title={`${r.name}: ${r.share}%`} />
              ))}
          </div>
          <ul className="mt-4 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {o.rows
              .filter((r) => r.leads)
              .map((r, i) => (
                <li key={r.sourceId ?? "none"} className="anim-fade flex items-center gap-2.5 text-[14px]" style={{ "--i": i + 4 } as React.CSSProperties}>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--stage-${r.color}-dot)` }} aria-hidden />
                  <span className="flex-1 truncate">{r.name}</span>
                  <span className="text-muted">{r.leads}</span>
                  <b className="w-14 text-right font-semibold">{pctLabel(r.share)}</b>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[14px]">
            <thead>
              <tr className="border-b border-line text-[12.5px] text-muted">
                <th className="py-2 font-medium">Origem</th>
                <th className="py-2 text-right font-medium">Leads</th>
                <th className="py-2 text-right font-medium">Reuniões</th>
                <th className="py-2 text-right font-medium">Vendas</th>
                <th className="py-2 pl-4 font-medium">Faturamento</th>
              </tr>
            </thead>
            <tbody>
              {[...o.rows]
                .sort((a, b) => b.revenueCents - a.revenueCents || b.leads - a.leads)
                .map((r, i) => (
                  <tr key={r.sourceId ?? "none"} className="anim-fade border-b border-line last:border-0" style={{ "--i": i } as React.CSSProperties}>
                    <td className="py-2.5">
                      <span className="inline-flex items-center gap-2">
                        <span className="size-2.5 rounded-full" style={{ background: `var(--stage-${r.color}-dot)` }} aria-hidden />
                        {r.name}
                      </span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{r.leads}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.meetings}</td>
                    <td className="py-2.5 text-right tabular-nums">{r.sales}</td>
                    <td className="py-2.5 pl-4">
                      <span className="flex items-center gap-2">
                        <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-[#eef3f1]" aria-hidden>
                          <span className="bar-grow block h-full rounded-full bg-brand" style={{ width: `${(r.revenueCents / maxRev) * 100}%`, "--i": i } as React.CSSProperties} />
                        </span>
                        <b className="font-semibold tabular-nums">{formatBRL(r.revenueCents, true)}</b>
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------- Filtros ----------
type FilterKey = "sellerId" | "closerId" | "productId" | "sourceId" | "campaign";
const FILTER_LABEL: Record<FilterKey, string> = { sellerId: "Social Seller", closerId: "Closer", productId: "Produto", sourceId: "Origem", campaign: "Campanha" };

function useFilters() {
  const [sellerId, setSeller] = useQueryParam("seller", "");
  const [closerId, setCloser] = useQueryParam("closer", "");
  const [productId, setProduct] = useQueryParam("produto", "");
  const [sourceId, setSource] = useQueryParam("origem", "");
  const [campaign, setCampaign] = useQueryParam("campanha", "");
  const values = { sellerId, closerId, productId, sourceId, campaign };
  const setters: Record<FilterKey, (v: string) => void> = { sellerId: setSeller, closerId: setCloser, productId: setProduct, sourceId: setSource, campaign: setCampaign };
  return { values, set: (k: FilterKey, v: string) => setters[k](v) };
}

function FiltersPopover({ values, set, options }: { values: Record<FilterKey, string>; set: (k: FilterKey, v: string) => void; options?: Options }) {
  const active = (Object.keys(values) as FilterKey[]).filter((k) => values[k]).length;
  const lists: Record<FilterKey, { value: string; label: string }[]> = {
    sellerId: options?.sellers.map((p) => ({ value: p.id, label: p.name })) ?? [],
    closerId: options?.closers.map((p) => ({ value: p.id, label: p.name })) ?? [],
    productId: options?.products.map((p) => ({ value: p.id, label: p.name })) ?? [],
    sourceId: options?.sources.map((p) => ({ value: p.id, label: p.name })) ?? [],
    campaign: options?.campaigns.map((c) => ({ value: c, label: c })) ?? [],
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={cx("inline-flex h-11 items-center gap-2 rounded-[14px] border px-4 text-[14px] font-medium", active ? "border-brand bg-selected text-brand-dark" : "border-line bg-white hover:bg-page")}>
          <SlidersHorizontal className="size-4" aria-hidden /> Filtros{active ? ` · ${active}` : ""}
          <ChevronDown className="size-4 text-muted" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="z-50 w-[320px] max-w-[92vw] rounded-[18px] border border-line bg-white p-4 shadow-[var(--shadow-pop)]">
          <div className="flex flex-col gap-3">
            {(Object.keys(FILTER_LABEL) as FilterKey[]).map((k) => (
              <Field key={k} label={FILTER_LABEL[k]} htmlFor={`f-${k}`}>
                <Select id={`f-${k}`} value={values[k]} onChange={(e) => set(k, e.target.value)}>
                  <option value="">Todos</option>
                  {lists[k].map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
            {active > 0 && (
              <Button variant="ghost" size="sm" onClick={() => (Object.keys(values) as FilterKey[]).forEach((k) => set(k, ""))}>
                Limpar filtros
              </Button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DashboardView() {
  const me = useMe();
  const isManager = me.permissions.dataAll;
  const [period, setPeriod] = useQueryParam("periodo", "month");
  const [from, setFrom] = useQueryParam("de", "");
  const [to, setTo] = useQueryParam("ate", "");
  const { values, set } = useFilters();
  const [newOpen, setNewOpen] = useState(false);
  const openContact = useOpenContact();
  const ready = period !== "custom" || (from && to);
  const key = ready ? `/api/dashboard/commercial${qs({ period, from: period === "custom" ? from : "", to: period === "custom" ? to : "", ...(isManager ? values : {}) })}` : null;
  const { data, error, isLoading, mutate } = useSWR<Dash>(key, fetcher, { keepPreviousData: true });
  const { data: options } = useSWR<Options>(isManager ? "/api/dashboard/options" : null, fetcher);
  const nameOf = (k: FilterKey, v: string) => {
    if (k === "campaign") return v;
    const list = k === "sellerId" ? options?.sellers : k === "closerId" ? options?.closers : k === "productId" ? options?.products : options?.sources;
    return list?.find((x) => x.id === v)?.name ?? "…";
  };

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title="Dashboard"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle={isManager ? "Meta, faturamento, conversões e origem — calculados a partir do que acontece no CRM." : "Seus números e os da meta da equipe."}
        actions={
          <Button size="lg" icon={<Plus className="size-5" />} onClick={() => setNewOpen(true)} className="rounded-[16px] w-full sm:w-auto">
            Novo contato
          </Button>
        }
      />

      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <div className="flex max-w-full overflow-x-auto scroll-thin rounded-[14px] border border-line bg-white p-1" role="tablist" aria-label="Período">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              role="tab"
              aria-selected={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={cx("whitespace-nowrap rounded-[10px] px-3 sm:px-3.5 py-2 text-[13.5px] font-medium transition-colors", period === p.value ? "bg-brand text-white" : "text-muted hover:bg-page hover:text-ink")}
            >
              {p.label}
            </button>
          ))}
        </div>
        {period === "custom" && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label="De" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 w-[150px] bg-white" />
            <span className="text-muted">até</span>
            <Input type="date" aria-label="Até" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 w-[150px] bg-white" />
          </div>
        )}
        {isManager && (
          <div className="ml-auto">
            <FiltersPopover values={values} set={set} options={options} />
          </div>
        )}
      </div>
      {isManager && (Object.keys(values) as FilterKey[]).some((k) => values[k]) && (
        <div className="-mt-3 flex flex-wrap gap-2">
          {(Object.keys(values) as FilterKey[])
            .filter((k) => values[k])
            .map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-selected py-1 pl-3 pr-1 text-[13px] text-brand-dark">
                {FILTER_LABEL[k]}: <b className="font-semibold">{nameOf(k, values[k])}</b>
                <IconButton label={`Remover filtro ${FILTER_LABEL[k]}`} size="sm" onClick={() => set(k, "")}>
                  <X className="size-3.5" />
                </IconButton>
              </span>
            ))}
        </div>
      )}

      {!ready ? (
        <Card className="p-6 text-[14px] text-muted">Escolha o início e o fim do período.</Card>
      ) : error && !data ? (
        <Card>
          <ErrorState error={error} onRetry={() => mutate()} />
        </Card>
      ) : isLoading && !data ? (
        <LoadingState rows={4} />
      ) : data ? (
        <>
          <MetaCard meta={data.meta} />
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5 [&>*:first-child]:col-span-2 lg:[&>*:first-child]:col-span-1">
            <Kpi i={0} icon={<CircleDollarSign />} label="Faturamento" value={<CountUp value={data.kpis.revenueCents} format={brlCount} duration={1400} />} sub="Valor das vendas ganhas no período" href="/comercial?aba=ganhas" />
            <Kpi i={1} icon={<Handshake />} label="Vendas realizadas" value={<CountUp value={data.kpis.sales} delay={70} />} sub={data.kpis.sales ? `Ticket médio ${formatBRL(data.kpis.avgTicketCents, true)}` : undefined} />
            <Kpi i={2} icon={<CalendarDays />} label="Reuniões agendadas" value={<CountUp value={data.kpis.scheduled} delay={140} />} tip="Reuniões marcadas no período (pela data em que foram agendadas)." href="/agendamentos" />
            <Kpi i={3} icon={<Flag />} label="Reuniões realizadas" value={<CountUp value={data.kpis.done} delay={210} />} sub={data.kpis.noShow ? `${data.kpis.noShow} não compareceu` : undefined} tip="Reuniões marcadas como realizadas (ou movidas para “Reunião realizada” no Kanban)." />
            <Kpi i={4} icon={<MessagesSquare />} label="Contatos realizados" value={<CountUp value={data.kpis.contacts} delay={280} />} tip="Pessoas com quem a equipe falou no período: mensagem enviada, lead marcado como “Falei”, cartão movido ou reunião marcada. Cada pessoa conta uma vez por dia." />
          </div>
          <Conversions k={data.kpis} c={data.conversions} />
          {isManager && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
              <SalesRanking rows={data.closerRanking} />
              <SchedulerRanking rows={data.schedulerRanking} />
            </div>
          )}
          <Origins o={data.origins} />
          {!isManager && <OpsSection showConversations={me.user.role === "seller"} />}
        </>
      ) : null}
      <NewContactDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => openContact(id)} />
    </div>
  );
}
