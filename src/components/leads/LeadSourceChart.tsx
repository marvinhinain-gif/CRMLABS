"use client";

import { useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { BarChart3, Check, ChevronDown, X } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { LEAD_PERIOD_LABEL, PERIOD_DAYS, type LeadPeriod } from "@/lib/leadSources";
import { Card, cx, ErrorState } from "@/components/ui";
import { CountUp } from "@/components/motion/CountUp";

type SourceStat = { id: string; name: string; color: string; n: number; previous: number | null };
type Point = { t: string; total: number; bySource: Record<string, number> };
export type SourceStats = { periodo: LeadPeriod; unit: "day" | "week" | "month"; total: number; previousTotal: number | null; sources: SourceStat[]; series: Point[] };

/** Fontes visíveis antes de "Ver mais". */
const SHOWN = 6;
const dot = (c: string) => `var(--stage-${c}-dot)`;
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);

/** "2026-10-13" → data local (sem pular de dia por fuso). */
const parseDay = (t: string) => {
  const [y, m, d] = t.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", o);
const short = fmt({ day: "2-digit", month: "2-digit" });
const month = fmt({ month: "short", year: "2-digit" });
const longDay = fmt({ weekday: "short", day: "numeric", month: "short" });
const longMonth = fmt({ month: "long", year: "numeric" });

function tickLabel(t: string, unit: SourceStats["unit"]) {
  const d = parseDay(t);
  return unit === "month" ? month.format(d).replace(". de ", "/").replace(".", "") : short.format(d);
}
function pointTitle(t: string, unit: SourceStats["unit"]) {
  const d = parseDay(t);
  if (unit === "day") return longDay.format(d);
  if (unit === "week") return `Semana de ${short.format(d)}`;
  return longMonth.format(d);
}

function Delta({ now, before, label }: { now: number; before: number | null; label: string }) {
  if (before === null) return null;
  const diff = now - before;
  const text = before === 0 ? (now === 0 ? "igual" : `+${now}`) : `${diff > 0 ? "+" : ""}${Math.round((diff / before) * 100)}%`;
  return (
    <span className="text-[12.5px] text-muted">
      <span className={cx("font-semibold", diff > 0 ? "text-success" : diff < 0 ? "text-danger" : "text-muted")}>
        {diff > 0 ? "▲" : diff < 0 ? "▼" : "•"} {text}
      </span>{" "}
      {label}
    </span>
  );
}

/** Barras horizontais: uma linha por origem, do maior para o menor. Clicar filtra a lista. */
function SourceBars({ data, active, hover, onHover, onPick }: { data: SourceStats; active: string; hover: string | null; onHover: (id: string | null) => void; onPick: (id: string) => void }) {
  const [all, setAll] = useState(false);
  const max = Math.max(1, ...data.sources.map((s) => s.n));
  const focus = active || hover;
  const hidden = data.sources.length - SHOWN;
  const shown = all || hidden <= 1 ? data.sources : data.sources.filter((s, i) => i < SHOWN || s.id === active);
  return (
    <div className="flex flex-col gap-1">
      <ul className="flex flex-col gap-1" aria-label="Leads por fonte de tráfego">
        {shown.map((s, i) => {
          const on = active === s.id;
          const dim = focus && focus !== s.id;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onPick(s.id)}
                onMouseEnter={() => onHover(s.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(s.id)}
                onBlur={() => onHover(null)}
                aria-pressed={on}
                title={on ? "Clique para tirar o filtro" : `Ver só os leads de ${s.name}`}
                className={cx(
                  "group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[14px] px-3 py-2 text-left transition-[background,opacity] duration-200",
                  on ? "bg-selected ring-1 ring-[#c9ebdc]" : "hover:bg-page",
                  dim && "opacity-45",
                )}
              >
                <span className="flex min-w-0 items-center gap-2 text-[14px] font-medium">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: dot(s.color) }} aria-hidden />
                  <span className="truncate">{s.name}</span>
                  {on && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
                </span>
                <span className="flex items-baseline gap-2 tabular-nums">
                  <span className="text-[15px] font-semibold">{s.n}</span>
                  <span className="w-10 text-right text-[12.5px] text-muted">{pct(s.n, data.total)}%</span>
                </span>
                <span className="col-span-2 h-2.5 overflow-hidden rounded-full bg-page">
                  <span className="bar-grow bar-shine block h-full rounded-full" style={{ width: `${Math.max(2, (s.n / max) * 100)}%`, background: dot(s.color), "--i": i } as React.CSSProperties} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {hidden > 1 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="mx-3 inline-flex h-8 items-center gap-1 self-start rounded-full px-1 text-[13px] font-medium text-brand hover:underline">
          {all ? "Mostrar menos" : `Ver mais ${hidden} fontes`} <ChevronDown className={cx("size-4 transition-transform", all && "rotate-180")} aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Colunas da evolução. Com uma origem em foco, a parte dela aparece na cor da origem. */
function Timeline({ data, focus }: { data: SourceStats; focus: string | null }) {
  const [hi, setHi] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pts = data.series;
  const max = Math.max(1, ...pts.map((p) => p.total));
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const focused = focus ? data.sources.find((s) => s.id === focus) : null;
  const n = pts.length;
  const every = Math.ceil(n / 7);
  const hp = hi !== null ? pts[hi] : null;
  const rows = hp ? data.sources.map((s) => ({ ...s, v: hp.bySource[s.id] ?? 0 })).filter((s) => s.v > 0 || s.id === focused?.id) : [];
  // A fonte em foco vem primeiro no resumo da coluna.
  if (focused) rows.sort((a, b) => Number(b.id === focused.id) - Number(a.id === focused.id));

  const pick = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !n) return;
    setHi(Math.min(n - 1, Math.max(0, Math.floor(((clientX - r.left) / r.width) * n))));
  };

  if (!n) return null;
  return (
    <div className="flex min-w-0 flex-col">
      <div className="mb-2 flex items-center justify-between gap-2 text-[12.5px] text-muted">
        <span>Leads por {data.unit === "day" ? "dia" : data.unit === "week" ? "semana" : "mês"}</span>
        {focused && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: dot(focused.color) }} aria-hidden />
            {focused.name}
            <span className="ml-1.5 h-2.5 w-2.5 rounded-[3px] bg-[#dfe8e5]" aria-hidden />
            Outras
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="flex h-[220px] flex-col justify-between pb-0 text-right text-[11px] tabular-nums text-muted" aria-hidden>
          <span>{nice}</span>
          <span>{nice > 1 ? Math.round(nice / 2) : ""}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1">
          <div
            ref={box}
            className="relative h-[220px] cursor-crosshair touch-none"
            onPointerMove={(e) => pick(e.clientX)}
            onPointerDown={(e) => pick(e.clientX)}
            onPointerLeave={() => setHi(null)}
            tabIndex={0}
            data-chart="evolucao"
            role="img"
            aria-label={`Evolução de leads: ${pts.map((p) => `${pointTitle(p.t, data.unit)}: ${p.total}`).join("; ")}`}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") setHi((h) => Math.min(n - 1, (h ?? -1) + 1));
              if (e.key === "ArrowLeft") setHi((h) => Math.max(0, (h ?? n) - 1));
            }}
            onBlur={() => setHi(null)}
          >
            {/* grade discreta */}
            {[0, 0.5, 1].map((g) => (
              <span key={g} className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${g * 100}%` }} aria-hidden />
            ))}
            <div className="absolute inset-0 flex items-end" style={{ gap: n > 40 ? 1 : 2 }}>
              {pts.map((p, i) => {
                const part = focused ? (p.bySource[focused.id] ?? 0) : p.total;
                const rest = p.total - part;
                const h = (v: number) => `${(v / nice) * 100}%`;
                return (
                  <div key={p.t} className={cx("flex h-full min-w-0 flex-1 flex-col justify-end transition-opacity", hi !== null && hi !== i && "opacity-55")}>
                    {focused && rest > 0 && <span className="block w-full rounded-t-[4px] bg-[#dfe8e5] transition-[height] duration-500" style={{ height: h(rest), marginBottom: part > 0 ? 2 : 0 }} />}
                    {part > 0 && (
                      <span
                        className={cx("block w-full transition-[height,background] duration-500", !(focused && rest > 0) && "rounded-t-[4px]")}
                        style={{ height: h(part), background: focused ? dot(focused.color) : "var(--color-brand-accent)" }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {hi !== null && <span className="pointer-events-none absolute inset-y-0 w-px bg-ink/25" style={{ left: `${((hi + 0.5) / n) * 100}%` }} aria-hidden />}
          </div>
          <div className="relative mt-1.5 h-4 text-[11px] text-muted" aria-hidden>
            {pts.map((p, i) =>
              i % every === 0 ? (
                <span key={p.t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${((i + 0.5) / n) * 100}%` }}>
                  {tickLabel(p.t, data.unit)}
                </span>
              ) : null,
            )}
          </div>
          {hp && (
            <div
              className="pointer-events-none absolute top-0 z-10 w-[210px] rounded-[14px] border border-line bg-white p-3 text-[12.5px] shadow-[var(--shadow-pop)]"
              style={hi! / n > 0.5 ? { right: `${(1 - hi! / n) * 100}%`, marginRight: 10 } : { left: `${((hi! + 1) / n) * 100}%`, marginLeft: 10 }}
              role="status"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted">{pointTitle(hp.t, data.unit)}</span>
                <span className="text-[15px] font-semibold tabular-nums">{hp.total}</span>
              </div>
              {rows.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1 border-t border-line pt-2">
                  {rows.map((s) => (
                    <li key={s.id} className={cx("flex items-center gap-2", focused && focused.id !== s.id && "opacity-50")}>
                      <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: dot(s.color) }} aria-hidden />
                      <span className="min-w-0 flex-1 truncate text-muted">{s.name}</span>
                      <span className="font-semibold tabular-nums">{s.v}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Participação de cada fonte no total do período, numa barra só. */
function ShareBar({ data, focus, onHover, onPick }: { data: SourceStats; focus: string | null; onHover: (id: string | null) => void; onPick: (id: string) => void }) {
  return (
    <div className="mt-auto pt-5">
      <div className="mb-2 text-[12.5px] text-muted">Participação no total</div>
      <div className="flex h-4 w-full gap-[2px] overflow-hidden rounded-full" onMouseLeave={() => onHover(null)}>
        {data.sources.map((s) => (
          <button
            key={s.id}
            type="button"
            tabIndex={-1}
            onMouseEnter={() => onHover(s.id)}
            onClick={() => onPick(s.id)}
            title={`${s.name}: ${s.n} (${pct(s.n, data.total)}%)`}
            className={cx("h-full min-w-[3px] transition-opacity duration-200", focus && focus !== s.id && "opacity-30")}
            style={{ flexGrow: s.n, background: dot(s.color) }}
          >
            <span className="sr-only">{`${s.name}: ${s.n}`}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
        {data.sources.slice(0, 4).map((s) => (
          <span key={s.id} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: dot(s.color) }} aria-hidden />
            {s.name} <span className="font-semibold tabular-nums text-ink">{pct(s.n, data.total)}%</span>
          </span>
        ))}
        {data.sources.length > 4 && <span>+{data.sources.length - 4} fontes</span>}
      </div>
    </div>
  );
}

/**
 * Card "Leads por fonte de tráfego": total do período, ranking das origens e evolução.
 * Clicar numa origem filtra a lista abaixo (clicar de novo tira o filtro).
 */
/** Mesma chave no gráfico e no filtro de fonte: uma requisição só. */
export function useLeadSourceStats(f: { periodo: LeadPeriod; classe: string; owner: string }) {
  return useSWR<SourceStats>(`/api/leads/sources${qs({ periodo: f.periodo, classe: f.classe, assignedTo: f.owner })}`, fetcher, { keepPreviousData: true });
}

export function LeadSourceChart({ periodo, classe, owner, fonte, onPickSource }: { periodo: LeadPeriod; classe: string; owner: string; fonte: string; onPickSource: (id: string) => void }) {
  const { data, error, isLoading, mutate } = useLeadSourceStats({ periodo, classe, owner });
  const [hover, setHover] = useState<string | null>(null);
  const top = data?.sources[0];
  const activeName = useMemo(() => data?.sources.find((s) => s.id === fonte)?.name, [data, fonte]);
  const periodText = periodo === "all" ? "desde o primeiro lead" : `nos últimos ${PERIOD_DAYS[periodo]} dias`;

  return (
    <Card className={cx("overflow-hidden p-4 transition-opacity sm:p-5", isLoading && data && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <h2 className="flex items-center gap-2 text-[16px] font-semibold">
            <BarChart3 className="size-[18px] text-brand" aria-hidden /> Leads por fonte de tráfego
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">Clique numa fonte para ver só os leads dela.</p>
        </div>
        {fonte && (
          <button
            type="button"
            onClick={() => onPickSource(fonte)}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#c9ebdc] bg-selected px-3 text-[13px] font-medium text-brand hover:bg-[#d6f0e4]"
          >
            Filtrando: {activeName ?? "fonte"} <X className="size-3.5" aria-hidden />
            <span className="sr-only">(tirar filtro)</span>
          </button>
        )}
      </div>

      {error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !data ? (
        <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-3">
            <div className="skeleton h-12 w-40" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-9" />
            ))}
          </div>
          <div className="skeleton h-[200px]" />
        </div>
      ) : data.total === 0 ? (
        <p className="mt-4 rounded-[14px] bg-page px-4 py-6 text-center text-[14px] text-muted">Nenhum lead chegou {periodText}. Escolha um período maior.</p>
      ) : (
        <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="px-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[34px] font-semibold leading-none tracking-tight tabular-nums">
                  <CountUp value={data.total} />
                </span>
                <span className="text-[14px] text-muted">
                  {data.total === 1 ? "lead" : "leads"} {periodText}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                <Delta now={data.total} before={data.previousTotal} label={`vs ${LEAD_PERIOD_LABEL[periodo]} anteriores`} />
                {top && data.sources.length > 1 && (
                  <span className="text-[12.5px] text-muted">
                    Mais forte: <span className="font-semibold text-ink">{top.name}</span> ({pct(top.n, data.total)}%)
                  </span>
                )}
              </div>
            </div>
            <SourceBars data={data} active={fonte} hover={hover} onHover={setHover} onPick={onPickSource} />
          </div>
          <div className="flex min-w-0 flex-col">
            <Timeline data={data} focus={fonte || hover} />
            <ShareBar data={data} focus={fonte || hover} onHover={setHover} onPick={onPickSource} />
          </div>
        </div>
      )}
    </Card>
  );
}
