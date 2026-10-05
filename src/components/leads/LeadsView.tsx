"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { CalendarCheck, ChevronRight, Inbox, Plug, Search } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { formatPhone, longDayTime, relativeTime } from "@/lib/format";
import { Avatar, Button, Card, cx, EmptyState, ErrorState, LoadingState, PageHeader, Select } from "@/components/ui";
import { SourceChip } from "@/components/integrations/shared";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { LeadSheet, LEAD_STATUS } from "./LeadSheet";

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
};
type ListData = { rows: LeadRow[]; total: number; page: number; pageSize: number; counts: Record<string, number> };

const FILTERS = [
  { value: "open", label: "Para atender" },
  { value: "new", label: "Novos" },
  { value: "scheduled", label: "Agendados" },
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

function LeadCard({ l, i, onOpen }: { l: LeadRow; i: number; onOpen: () => void }) {
  const st = LEAD_STATUS[l.status];
  const fresh = l.status === "new" && Date.now() - new Date(l.createdAt).getTime() < 30 * 60000;
  return (
    <li className="anim-fade" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
      <button onClick={onOpen} className="group flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-page/60 active:bg-page sm:items-center sm:px-5">
        <span className="relative shrink-0">
          <Avatar name={l.name} size={46} />
          {fresh && <span className="absolute -right-0.5 -top-0.5 size-3.5 rounded-full border-2 border-white bg-brand-accent animate-[crm-pulse_1.4s_ease-in-out_infinite]" aria-label="Chegou agora" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[15.5px] font-semibold">{l.name}</span>
            <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-medium", st.cls)}>{st.label}</span>
          </span>
          <span className="mt-0.5 block truncate text-[13px] text-muted">
            {[formatPhone(l.phone), l.instagram && `@${l.instagram}`].filter(Boolean).join(" · ")}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {l.sourceName && <SourceChip name={l.sourceName} color={l.sourceColor} />}
            {l.formName && <span className="rounded-full bg-page px-2.5 py-0.5 text-muted">{l.formName}</span>}
            {l.productName && <span className="rounded-full bg-page px-2.5 py-0.5 text-ink">Interesse: {l.productName}</span>}
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
        <ChevronRight className="mt-3 size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 sm:mt-0" aria-hidden />
      </button>
    </li>
  );
}

function LeadList() {
  const me = useMe();
  const team = useTeam();
  const [status, setStatus] = useQueryParam("status", "open");
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [, setLeadParam] = useQueryParam("lead", "");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounced(q);
  const { data, error, isLoading, mutate } = useSWR<ListData>(`/api/leads${qs({ status, q: debounced, assignedTo: owner, page })}`, fetcher, { keepPreviousData: true });
  useEffect(() => setPage(1), [status, debounced, owner]);
  const counts = data?.counts ?? {};
  const countFor = (v: string) => (v === "open" ? (counts.new ?? 0) + (counts.contacted ?? 0) + (counts.no_answer ?? 0) : v === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[v] ?? 0));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scroll-thin lg:flex-1" role="tablist" aria-label="Situação">
          {FILTERS.map((f) => {
            const active = status === f.value;
            return (
              <button
                key={f.value}
                role="tab"
                aria-selected={active}
                onClick={() => setStatus(f.value)}
                className={cx("inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors", active ? "border-[#c9ebdc] bg-selected text-brand" : "border-line bg-white text-ink hover:bg-page")}
              >
                {f.label}
                <span className={cx("rounded-full px-2 text-[12px]", active ? "bg-white" : "bg-page")}>{countFor(f.value)}</span>
              </button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <div className="relative flex-1 lg:w-[260px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome, WhatsApp, e-mail ou @" aria-label="Buscar leads" className="h-11 w-full rounded-[14px] border border-line bg-white pl-11 pr-3 text-[14px] focus:border-brand focus:outline-none focus:ring-4 focus:ring-[#008a65]/10" />
          </div>
          {me.permissions.dataAll && (
            <Select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="w-[150px] sm:w-[190px] bg-white">
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

      <Card className="overflow-hidden">
        {error && !data ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <LoadingState rows={5} className="p-4" />
        ) : !data?.rows.length ? (
          <EmptyState
            icon={<Inbox />}
            title={status === "open" ? "Nenhum lead esperando atendimento" : "Nenhum lead encontrado"}
            description={me.user.role === "admin" ? "Leads chegam pelas integrações (formulários, quizzes, webhooks). Configure em Integrações." : "Quando um novo lead chegar para você, ele aparece aqui e você recebe uma notificação."}
          />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {data.rows.map((l, i) => (
                <LeadCard key={l.id} l={l} i={i} onOpen={() => setLeadParam(l.id)} />
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
