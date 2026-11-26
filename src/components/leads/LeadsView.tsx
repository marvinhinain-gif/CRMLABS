"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronRight, Crown, Download, Flame, Inbox, LayoutDashboard, Loader2, Plug, Search, Snowflake, Trophy, Users } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import type { ForwardToKanbanResult } from "@/lib/types";
import { useMe, useTeam } from "@/lib/me";
import { useQueryParam, useSetQueryParams } from "@/lib/nav";
import { formatPhone, longDayTime, relativeTime } from "@/lib/format";
import { Avatar, Button, Card, cx, EmptyState, ErrorState, LoadingState, PageHeader, Select } from "@/components/ui";
import { SourceChip } from "@/components/integrations/shared";
import { WhatsAppButton } from "@/components/ui/WhatsApp";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { buyingPowerLabel, LEAD_CLASS, LEAD_CLASS_FILTERS, REVENUE_OPTIONS, UNCLASSIFIED, type LeadClass } from "@/lib/leadScore";
import { LEAD_PERIOD_LABEL, LEAD_PERIODS, NO_SOURCE, type LeadPeriod } from "@/lib/leadSources";
import { LeadClassBadge, LeadSheet, LEAD_STATUS } from "./LeadSheet";
import { LeadSourceChart, useLeadSourceStats } from "./LeadSourceChart";
import { CommunityBadge } from "@/components/community/CommunityBadge";

export type LeadRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  status: keyof typeof LEAD_STATUS;
  createdAt: string;
  preferredAt: string | null;
  preferredText: string | null;
  contactId: string;
  assignedTo: string | null;
  assignedName: string | null;
  formName: string | null;
  utmCampaign: string | null;
  sourceName: string | null;
  sourceColor: string | null;
  productName: string | null;
  appointmentAt: string | null;
  scoreClass: LeadClass | null;
  scoreClassManual: boolean;
  score: number | null;
  /** Faixa de faturamento respondida na aplicação (id da alternativa). */
  revenue: string | null;
  /** Poder de compra informado no formulário (Comunidade); null = não informou. */
  buyingPower: string | null;
  /** Dono do contato e etapa do cartão quando o lead já está no Kanban de um SDR (null = fora do Kanban). */
  boardOwnerName: string | null;
  boardStageName: string | null;
  /** O contato está no CRM da Comunidade (Kanban do administrador) e em qual etapa. */
  inCommunity?: boolean;
  communityStageName?: string | null;
};
type ListData = { rows: LeadRow[]; total: number; page: number; pageSize: number; counts: Record<string, number>; topCount: number; classCounts: Record<string, number>; allCount?: number; community?: { total: number; quente: number; frio: number } };

const FILTERS = [
  { value: "open", label: "Para atender" },
  { value: "new", label: "Novos" },
  { value: "kanban", label: "No Kanban" },
  { value: "scheduled", label: "Agendados" },
  { value: "top20", label: "TOP 20 Leads" },
  { value: "comunidade", label: "Comunidade El Club" },
  { value: "disqualified", label: "Descartados" },
  { value: "all", label: "Todos" },
] as const;

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

const WORK_STATUSES: readonly string[] = ["new", "contacted", "no_answer"];

const TEMPS = [
  { value: "", label: "Todos", icon: Users },
  { value: "quente", label: "Comunidade quente", icon: Flame },
  { value: "frio", label: "Comunidade frio", icon: Snowflake },
] as const;

/** Botão rápido "Para o meu Kanban" (≥ 44px de toque). Não abre o lead. */
function ToKanbanButton({ busy, onClick, className }: { busy: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      disabled={busy}
      title="O lead entra na fase de Ligação da cadência"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx("inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[12px] border border-[#c9ebdc] bg-selected px-3 text-[13px] font-semibold text-brand transition-colors hover:brightness-[0.98] disabled:opacity-60", className)}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <LayoutDashboard className="size-4" aria-hidden />}
      Para o meu Kanban
    </button>
  );
}

/** Botão "Enviar para o CRM da Comunidade" (≥ 44px de toque). Não abre o lead. */
function ToCommunityButton({ busy, disabled, onClick, className, label = "Enviar para o CRM da Comunidade" }: { busy: boolean; disabled?: boolean; onClick: () => void; className?: string; label?: string }) {
  return (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cx("inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-[12px] border border-[#d9c9fb] bg-[#f1ebff] px-3 text-[13px] font-semibold text-[#5b21b6] transition-colors hover:brightness-[0.98] disabled:opacity-60", className)}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Crown className="size-4" aria-hidden />}
      {label}
    </button>
  );
}

function LeadCard({
  l,
  i,
  rank,
  community,
  onOpen,
  onToKanban,
  toKanbanBusy,
  onToCommunity,
  toCommunityBusy,
  selected,
  onSelect,
}: {
  l: LeadRow;
  i: number;
  rank?: number;
  community?: boolean;
  onOpen: () => void;
  onToKanban?: () => void;
  toKanbanBusy?: boolean;
  /** Aba Comunidade El Club (admin/gestor): envia este lead para o CRM da Comunidade. */
  onToCommunity?: () => void;
  toCommunityBusy?: boolean;
  /** Seleção múltipla (aba Comunidade El Club). */
  selected?: boolean;
  onSelect?: (v: boolean) => void;
}) {
  const st = LEAD_STATUS[l.status];
  const inKanban = !!(l.boardStageName || l.boardOwnerName);
  const quick = onToKanban && !inKanban && WORK_STATUSES.includes(l.status);
  const fresh = l.status === "new" && Date.now() - new Date(l.createdAt).getTime() < 30 * 60000;
  const toCommunity = onToCommunity && !l.inCommunity;
  return (
    <li className="group anim-fade transition-colors hover:bg-page/60 active:bg-page" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
      <div className="flex items-start sm:items-center">
        {onSelect && (
          <label className="flex size-11 shrink-0 cursor-pointer items-center justify-center self-start pl-2 pt-6 sm:self-center sm:pl-3 sm:pt-0" title="Selecionar lead">
            <input type="checkbox" checked={!!selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Selecionar ${l.name}`} className="size-5 cursor-pointer rounded-[6px] border-line accent-[#008a65]" />
          </label>
        )}
        <button onClick={onOpen} className={cx("flex min-w-0 flex-1 items-start gap-3 py-3.5 text-left sm:items-center", onSelect ? "pl-2 pr-4 sm:pl-2 sm:pr-5" : "px-4 sm:px-5")}>
          {rank && (
            <span className={cx("mt-3 w-7 shrink-0 text-center text-[15px] font-bold tabular-nums sm:mt-0", rank <= 3 ? "text-brand" : "text-muted")} aria-label={`${rank}º lugar`}>
              {rank}º
            </span>
          )}
          <span className="relative shrink-0">
            <Avatar name={l.name} size={46} />
            {fresh && <span className="absolute -right-0.5 -top-0.5 size-3.5 rounded-full border-2 border-white bg-brand-accent animate-[crm-pulse_1.4s_ease-in-out_infinite]" aria-label="Chegou agora" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[15.5px] font-semibold">{l.name}</span>
              {inKanban && l.boardOwnerName ? (
                <span className="rounded-full bg-info-soft px-2.5 py-0.5 text-[12px] font-medium text-info">Em contato com {l.boardOwnerName.split(" ")[0]}</span>
              ) : (
                <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-medium", st.cls)}>{st.label}</span>
              )}
              {l.inCommunity && <CommunityBadge size="sm" className="!px-2.5 !text-[12px]" label={l.communityStageName ? `Comunidade · ${l.communityStageName}` : "Comunidade"} />}
              <LeadClassBadge cls={l.scoreClass} score={l.score} manual={l.scoreClassManual} />
              {community &&
                (l.buyingPower ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1e6] px-2.5 py-0.5 text-[12px] font-semibold text-[#b54708]">
                    <Flame className="size-3.5" aria-hidden /> Quente
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2.5 py-0.5 text-[12px] font-medium text-info">
                    <Snowflake className="size-3.5" aria-hidden /> Frio
                  </span>
                ))}
            </span>
            <span className="mt-0.5 block truncate text-[13px] text-muted">
              {[formatPhone(l.phone), l.instagram && `@${l.instagram}`].filter(Boolean).join(" · ")}
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
              {l.sourceName && <SourceChip name={l.sourceName} color={l.sourceColor} />}
              {l.formName && <span className="rounded-full bg-page px-2.5 py-0.5 text-muted">{l.formName}</span>}
              {l.productName && <span className="rounded-full bg-page px-2.5 py-0.5 text-ink">Interesse: {l.productName}</span>}
              {inKanban && (
                <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-selected px-2.5 py-0.5 font-medium text-brand">
                  <LayoutDashboard className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">
                    {l.boardOwnerName ? `Kanban de ${l.boardOwnerName.split(" ")[0]}` : "No Kanban"}
                    {l.boardStageName ? ` · ${l.boardStageName}` : ""}
                  </span>
                </span>
              )}
              {community && l.buyingPower && <span className="max-w-full rounded-full bg-success-soft px-2.5 py-0.5 font-medium text-success">{buyingPowerLabel(l.buyingPower)}</span>}
              {community && !l.buyingPower && <span className="rounded-full bg-page px-2.5 py-0.5 text-muted">Não informou poder de compra</span>}
              {rank && l.revenue && REVENUE_OPTIONS[l.revenue] && <span className="rounded-full bg-success-soft px-2.5 py-0.5 font-medium text-success">Faturamento: {REVENUE_OPTIONS[l.revenue].label}</span>}
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
              <span className="text-muted">{relativeTime(l.createdAt)}</span>
              {l.status === "scheduled" && l.appointmentAt ? (
                <span className="inline-flex items-center gap-1 font-medium text-brand">
                  <CalendarCheck className="size-3.5" aria-hidden /> {longDayTime(l.appointmentAt)}
                </span>
              ) : l.preferredAt ? (
                <span className="text-ink">Prefere {longDayTime(l.preferredAt)}</span>
              ) : null}
              {l.assignedName && (
                <span className="inline-flex items-center gap-1.5 text-muted">
                  <TeamAvatar userId={l.assignedTo} name={l.assignedName} size={18} /> {l.assignedName}
                </span>
              )}
            </span>
          </span>
        </button>
        {/* Faixa da direita também abre o lead (o botão do WhatsApp não propaga o clique). */}
        <span onClick={onOpen} className="flex shrink-0 cursor-pointer items-center gap-1 self-stretch pr-3 pt-3.5 sm:pr-4 sm:pt-0">
          {quick && !toCommunity && (
            <span className="mr-1 hidden sm:block">
              <ToKanbanButton busy={!!toKanbanBusy} onClick={onToKanban!} />
            </span>
          )}
          <WhatsAppButton variant="icon" phone={l.phone} name={l.name} className="size-11" />
          <ChevronRight className="pointer-events-none size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
      {/* Celular: o botão vai numa linha própria, alinhado ao texto, para não espremer o nome. */}
      {toCommunity ? (
        // Aba Comunidade El Club: as ações ficam numa linha própria (em qualquer tela), alinhadas ao texto.
        <div className={cx("-mt-1 flex flex-wrap gap-2 pb-3 pr-4", onSelect ? "pl-4 sm:pl-[110px]" : "pl-4 sm:pl-[78px]")}>
          <ToCommunityButton busy={!!toCommunityBusy} onClick={onToCommunity!} />
          {quick && <ToKanbanButton busy={!!toKanbanBusy} onClick={onToKanban!} />}
        </div>
      ) : (
        quick && (
          <div className={cx("-mt-1 pb-3 pr-4 sm:hidden", rank ? "pl-[114px]" : "pl-[74px]")}>
            <ToKanbanButton busy={!!toKanbanBusy} onClick={onToKanban!} />
          </div>
        )
      )}
    </li>
  );
}

function LeadList() {
  const me = useMe();
  const team = useTeam();
  const [status, setStatus] = useQueryParam("status", "open");
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [classe, setClasse] = useQueryParam("classe", "");
  const [fonte, setFonte] = useQueryParam("fonte", "");
  const [periodoParam, setPeriodo] = useQueryParam("periodo", "30d");
  const [temp, setTemp] = useQueryParam("temp", "");
  const [ordem, setOrdem] = useQueryParam("ordem", "recentes");
  const periodo: LeadPeriod = (LEAD_PERIODS as readonly string[]).includes(periodoParam) ? (periodoParam as LeadPeriod) : "30d";
  const setParams = useSetQueryParams();
  const [, setLeadParam] = useQueryParam("lead", "");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(q);
  const { mutate: globalMutate } = useSWRConfig();
  const isSdr = me.user.role !== "closer";
  const [forwarding, setForwarding] = useState<string | null>(null);
  const router = useRouter();
  /** CRM da Comunidade (Kanban do administrador): só admin e gestor enviam. */
  const canCommunity = me.permissions.dataAll;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sendingCommunity, setSendingCommunity] = useState<string | "bulk" | null>(null);
  const { data, error, isLoading, mutate } = useSWR<ListData>(`/api/leads${qs({ status, temp: status === "comunidade" ? temp : "", ordem, q: debounced, assignedTo: owner, classe, fonte, periodo, page })}`, fetcher, { keepPreviousData: true });
  const { data: stats } = useLeadSourceStats({ periodo, classe, owner });
  useEffect(() => setPage(1), [status, temp, ordem, debounced, owner, classe, fonte, periodo]);
  useEffect(() => setSelected(new Set()), [status, temp, ordem, debounced, owner, classe, fonte, periodo, page]);
  // Clicar numa fonte do gráfico mostra todos os leads dela no período (qualquer situação), para bater com o número do gráfico.
  const pickSource = (id: string) => (fonte === id ? setFonte(null) : setParams({ fonte: id, status: "all" }, { status: "open" }));
  const sourceOptions = stats?.sources ?? [];
  const counts = data?.counts ?? {};
  const top = status === "top20";
  const community = status === "comunidade";
  const countFor = (v: string) => (v === "top20" ? (data?.topCount ?? 0) : v === "comunidade" ? (data?.community?.total ?? 0) : v === "open" ? (counts.new ?? 0) + (counts.contacted ?? 0) + (counts.no_answer ?? 0) : v === "all" ? (data?.allCount ?? Object.entries(counts).reduce((a, [k, n]) => (k === "kanban" ? a : a + n), 0)) : (counts[v] ?? 0));
  const toKanban = async (l: LeadRow) => {
    setForwarding(l.id);
    try {
      const r = await api.post<ForwardToKanbanResult>(`/api/leads/${l.id}/kanban`, {});
      // Nas abas de trabalho o lead sai da lista na hora; a revalidação acerta contagens e as demais abas.
      if (status !== "all" && status !== "kanban") await mutate((d) => (d ? { ...d, rows: d.rows.filter((x) => x.id !== l.id), total: Math.max(0, d.total - 1) } : d), { revalidate: false });
      setSelected((cur) => {
        if (!cur.has(l.id)) return cur;
        const next = new Set(cur);
        next.delete(l.id);
        return next;
      });
      toast.success(`${l.name.split(" ")[0]} foi para o seu Kanban, em ${r.stageName}.`);
      await globalMutate((k) => typeof k === "string" && (k.startsWith("/api/leads") || k.startsWith("/api/me") || k.startsWith("/api/board") || k.startsWith("/api/contacts")));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setForwarding(null);
    }
  };
  const sendToCommunity = async (ids: string[], mode: string | "bulk") => {
    if (!ids.length) return;
    setSendingCommunity(mode);
    try {
      const r = await api.post<{ added: number; skipped: number }>("/api/community/entries", { leadIds: ids });
      const sent = new Set(ids);
      // Quem foi enviado sai da aba Comunidade El Club; a revalidação acerta contagens e as demais abas.
      if (community) await mutate((d) => (d ? { ...d, rows: d.rows.filter((x) => !sent.has(x.id)), total: Math.max(0, d.total - ids.length) } : d), { revalidate: false });
      setSelected((cur) => new Set([...cur].filter((id) => !sent.has(id))));
      const msg = r.added === 1 ? "1 enviado para o CRM da Comunidade" : `${r.added} enviados para o CRM da Comunidade`;
      const opts = {
        description: r.skipped ? `${r.skipped} já ${r.skipped === 1 ? "estava" : "estavam"} no CRM da Comunidade.` : undefined,
        action: { label: "Abrir CRM", onClick: () => router.push("/comunidade") },
      };
      if (r.added) toast.success(msg, opts);
      else toast.info("Nenhum lead novo enviado: já estavam no CRM da Comunidade.", { action: opts.action });
      await globalMutate((k) => typeof k === "string" && (k.startsWith("/api/leads") || k.startsWith("/api/me") || k.startsWith("/api/community")));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSendingCommunity(null);
    }
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const selectable = community && canCommunity ? (data?.rows ?? []).filter((r) => !r.inCommunity) : [];
  // Só conta quem ainda está visível e selecionável: ids de linhas que saíram da lista (realtime, Kanban, outro SDR) ficam de fora.
  const chosen = selectable.filter((r) => selected.has(r.id)).map((r) => r.id);
  const allSelected = selectable.length > 0 && chosen.length === selectable.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 scroll-thin" role="radiogroup" aria-label="Período">
        <span className="shrink-0 text-[13px] font-medium text-muted">Período</span>
        <div className="inline-flex shrink-0 rounded-full border border-line bg-white p-1">
          {LEAD_PERIODS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={periodo === p}
              onClick={() => setPeriodo(p)}
              className={cx("h-8 rounded-full px-3.5 text-[13.5px] font-medium transition-colors", periodo === p ? "bg-brand text-white shadow-sm" : "text-ink hover:bg-page")}
            >
              {LEAD_PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        {me.permissions.dataAll && (
          <a
            href={`/api/leads/export${qs({ status, temp: status === "comunidade" ? temp : "", ordem, q: debounced, assignedTo: owner, classe, fonte, periodo, format: "xlsx" })}`}
            download
            title="Baixa os leads desta lista (mesma aba e filtros) com todas as respostas dos formulários"
            className="ml-auto inline-flex h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-white px-4 text-[14px] font-medium text-ink hover:bg-page"
          >
            <Download className="size-4" aria-hidden /> Exportar para Excel
          </a>
        )}
      </div>
      <LeadSourceChart periodo={periodo} classe={classe} owner={owner} fonte={fonte} onPickSource={pickSource} />
      <div className="flex flex-col gap-3">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scroll-thin" role="tablist" aria-label="Situação">
          {FILTERS.map((f) => {
            const active = status === f.value;
            return (
              <button
                key={f.value}
                role="tab"
                aria-selected={active}
                // No celular a aba escolhida pode ficar fora da tela (lista rola para o lado): traz para a vista.
                ref={
                  active
                    ? (el) => {
                        const bar = el?.parentElement;
                        if (el && bar && (el.offsetLeft + el.offsetWidth > bar.scrollLeft + bar.clientWidth || el.offsetLeft < bar.scrollLeft)) bar.scrollLeft = el.offsetLeft - 8;
                      }
                    : undefined
                }
                onClick={() => setStatus(f.value)}
                className={cx("inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors", active ? "border-[#c9ebdc] bg-selected text-brand" : "border-line bg-white text-ink hover:bg-page")}
              >
                {f.value === "top20" && <Trophy className="size-4" aria-hidden />}
                {f.value === "comunidade" && <Flame className="size-4" aria-hidden />}
                {f.label}
                <span className={cx("rounded-full px-2 text-[12px]", active ? "bg-white" : "bg-page")}>{countFor(f.value)}</span>
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="relative col-span-2 sm:flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, WhatsApp, e-mail ou @" aria-label="Buscar leads" className="h-11 w-full rounded-[14px] border border-line bg-white pl-11 pr-3 text-[14px] focus:border-brand focus:outline-none focus:ring-4 focus:ring-[#008a65]/10" />
          </div>
          <Select aria-label="Fonte de tráfego" value={fonte} onChange={(e) => setFonte(e.target.value)} className="w-full bg-white sm:w-[200px]">
            <option value="">Toda fonte</option>
            {sourceOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.n})
              </option>
            ))}
            {fonte && !sourceOptions.some((s) => s.id === fonte) && <option value={fonte}>{fonte === NO_SOURCE.id ? NO_SOURCE.name : "Fonte escolhida"} (0)</option>}
          </Select>
          <Select aria-label="Lead score" value={classe} onChange={(e) => setClasse(e.target.value)} className="w-full bg-white sm:w-[220px]">
            <option value="">Todo lead score</option>
            {LEAD_CLASS_FILTERS.map((c) => (
              <option key={c} value={c}>
                {c === "none" ? UNCLASSIFIED.label : LEAD_CLASS[c].label} ({data?.classCounts?.[c] ?? 0})
              </option>
            ))}
          </Select>
          {!top && (
            <Select aria-label="Ordem" value={ordem === "antigos" || ordem === "pontuacao" ? ordem : "recentes"} onChange={(e) => setOrdem(e.target.value === "antigos" || e.target.value === "pontuacao" ? e.target.value : null)} className="w-full bg-white sm:w-[180px]">
              <option value="recentes">Mais recentes</option>
              <option value="antigos">Mais antigos</option>
              <option value="pontuacao">Maior pontuação</option>
            </Select>
          )}
          {me.permissions.dataAll && (
            <Select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className={cx("w-full bg-white sm:w-[200px]", top && "col-span-2")}>
              <option value="">Toda a equipe</option>
              {team
                .filter((m) => m.status === "active")
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
            </Select>
          )}
        </div>
      </div>

      {community && (
        <div className="flex flex-col gap-2.5">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scroll-thin" role="radiogroup" aria-label="Poder de compra">
            {TEMPS.map((t) => {
              const active = temp === t.value || (!t.value && temp !== "quente" && temp !== "frio");
              const n = t.value === "quente" ? data?.community?.quente : t.value === "frio" ? data?.community?.frio : data?.community?.total;
              const Icon = t.icon;
              return (
                <button
                  key={t.value || "todos"}
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTemp(t.value || null)}
                  className={cx(
                    "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors",
                    active ? (t.value === "quente" ? "border-[#f7c9a4] bg-[#fff1e6] text-[#b54708]" : t.value === "frio" ? "border-[#c7dbf5] bg-info-soft text-info" : "border-[#c9ebdc] bg-selected text-brand") : "border-line bg-white text-ink hover:bg-page",
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {t.label}
                  <span className={cx("rounded-full px-2 text-[12px]", active ? "bg-white" : "bg-page")}>{n ?? 0}</span>
                </button>
              );
            })}
          </div>
          <p className="text-[13.5px] text-muted">
            Leads para atender que ainda não estão com ninguém (sem responsável e fora de qualquer Kanban). <b className="font-semibold text-ink">Quente</b>: informou no formulário quanto pode investir ou quanto fatura. <b className="font-semibold text-ink">Frio</b>: não informou. Em &quot;Todos&quot;, os quentes vêm primeiro.
          </p>
        </div>
      )}
      {top && (
        <p className="text-[13.5px] text-muted">
          Os 20 melhores leads para entrar em contato agora: maior pontuação no quiz, faturamento de R$ 10 mil por mês para cima e fora de &quot;Não é nosso ICP&quot;. Agendados e descartados saem da lista e o próximo sobe.
        </p>
      )}
      <Card className="overflow-hidden">
        {error && !data ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <LoadingState rows={5} className="p-4" />
        ) : !data?.rows.length ? (
          <EmptyState
            icon={<Inbox />}
            title={top ? "Nenhum lead no TOP 20 agora" : community ? (temp === "quente" ? "Nenhum lead quente esperando" : temp === "frio" ? "Nenhum lead frio esperando" : "Nenhum lead da comunidade esperando") : status === "open" ? "Nenhum lead esperando atendimento" : status === "kanban" ? "Nenhum lead no Kanban" : "Nenhum lead encontrado"}
            description={status === "kanban" ? "Leads encaminhados para o Kanban de um SDR aparecem aqui, com o dono e a etapa." : top ? "Entram aqui os leads que responderam a aplicação com faturamento de R$ 10 mil por mês ou mais." : me.user.role === "admin" ? "Leads chegam pelas integrações (formulários, quizzes, webhooks). Configure em Integrações." : "Quando um novo lead chegar para você, ele aparece aqui e você recebe uma notificação."}
          />
        ) : (
          <>
            {selectable.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-[#faf7ff] px-4 py-2.5 sm:px-5">
                <label className="inline-flex min-h-11 cursor-pointer select-none items-center gap-2.5 text-[14px] font-medium text-ink">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allSelected && chosen.length > 0;
                    }}
                    onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.id)) : new Set())}
                    className="size-5 cursor-pointer rounded-[6px] border-line accent-[#008a65]"
                  />
                  {chosen.length ? `${chosen.length} selecionado${chosen.length === 1 ? "" : "s"}` : `Selecionar todos (${selectable.length})`}
                </label>
                <ToCommunityButton
                  className="ml-auto max-sm:w-full"
                  busy={sendingCommunity === "bulk"}
                  disabled={!chosen.length || !!sendingCommunity}
                  label={chosen.length ? `Enviar ${chosen.length} para o CRM da Comunidade` : "Selecione leads para enviar"}
                  onClick={() => sendToCommunity(chosen, "bulk")}
                />
              </div>
            )}
            <ul className="divide-y divide-line">
              {data.rows.map((l, i) => (
                <LeadCard
                  key={l.id}
                  l={l}
                  i={i}
                  community={community}
                  rank={top ? (data.page - 1) * data.pageSize + i + 1 : undefined}
                  onOpen={() => setLeadParam(l.id)}
                  onToKanban={isSdr ? () => toKanban(l) : undefined}
                  toKanbanBusy={forwarding === l.id}
                  onToCommunity={community && canCommunity ? () => sendToCommunity([l.id], l.id) : undefined}
                  toCommunityBusy={sendingCommunity === l.id}
                  selected={selected.has(l.id)}
                  onSelect={community && canCommunity && !l.inCommunity ? (v) => setSelected((cur) => { const next = new Set(cur); if (v) next.add(l.id); else next.delete(l.id); return next; }) : undefined}
                />
              ))}
            </ul>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13.5px] text-muted">
                <span>
                  {data.total} lead(s) · página {data.page} de {pages}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Anterior
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

export function LeadsView() {
  const me = useMe();
  const [leadId, setLeadId] = useQueryParam("lead", "");
  return (
    <div className="mx-auto flex max-w-[1200px] flex-col gap-5">
      <PageHeader
        title="Leads"
        subtitle="Pessoas que chegaram pelos formulários, quizzes e integrações. Atenda rápido e confirme a reunião."
        actions={
          me.user.role === "admin" ? (
            <Link href="/integracoes" className="inline-flex h-11 items-center gap-2 rounded-[14px] border border-line bg-white px-4 text-[14px] font-medium hover:bg-page">
              <Plug className="size-4" aria-hidden /> Configurar entradas
            </Link>
          ) : undefined
        }
      />
      <LeadList />
      <LeadSheet leadId={leadId || null} onClose={() => setLeadId(null)} />
    </div>
  );
}
