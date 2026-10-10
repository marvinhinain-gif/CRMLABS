"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Eye, Gauge, Inbox, Percent, Play, Star, TrendingUp, X } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { formatDateTime } from "@/lib/format";
import { Button, Card, EmptyState, ErrorState, IconButton, Input, LoadingState, NoPermission, Select, Sheet, SheetClose } from "@/components/ui";
import { BarList, DailyChart, Kpi, LEAD_STATUS_LABEL, pct, TierBadge, type FormDetail } from "./shared";
import { SubmissionView } from "./SubmissionView";

type Row = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  company: string | null;
  score: number | null;
  tierId: string | null;
  tierLabel: string | null;
  origin: string;
  channel: string;
  completedAt: string;
  contactId: string | null;
  duplicateOf: string | null;
  anonymizedAt: string | null;
  leadStatus: string | null;
  assignedName: string | null;
};
type Analytics = {
  views: number;
  starts: number;
  completed: number;
  completionRate: number;
  conversionRate: number;
  avgScore: number | null;
  qualified: number;
  tiers: { id: string; label: string; color: string; qualified: boolean; count: number }[];
  questions: { id: string; title: string; options: { id: string; label: string; count: number }[] }[];
  origins: { label: string; count: number }[];
  series: { day: string; count: number }[];
};
type FilterOptions = { tiers: { id: string; label: string; color: string }[]; origins: string[]; people: { id: string; name: string }[] };

const FILTER_KEYS = ["from", "to", "scoreMin", "scoreMax", "tier", "origin", "assignedTo", "status", "q", "duplicates"] as const;

export function ResponsesView({ id }: { id: string }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const allowed = me.permissions.forms;
  const filters = useMemo(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, sp.get(k) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>, [sp]);
  const page = Number(sp.get("pagina") ?? 1) || 1;
  const selected = sp.get("resposta");
  const [search, setSearch] = useState(filters.q);

  const setParams = (p: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(p)) (v ? next.set(k, v) : next.delete(k));
    if (!("pagina" in p) && !("resposta" in p)) next.delete("pagina");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };
  const query = qs(filters);
  const { data: form } = useSWR<FormDetail>(allowed ? `/api/forms/${id}` : null, fetcher);
  const { data: opts } = useSWR<FilterOptions>(allowed ? `/api/forms/${id}/responses/options` : null, fetcher);
  const { data: stats, error: statsError } = useSWR<Analytics>(allowed ? `/api/forms/${id}/analytics${query}` : null, fetcher, { keepPreviousData: true });
  const { data: list, error, isLoading, mutate } = useSWR<{ rows: Row[]; total: number; page: number; pageSize: number }>(allowed ? `/api/forms/${id}/responses${qs({ ...filters, page })}` : null, fetcher, { keepPreviousData: true });

  if (!allowed) return <NoPermission message="Formulários & Quizzes é gerenciado por administradores e gestores." />;
  const tierColor = (tid: string | null) => opts?.tiers.find((t) => t.id === tid)?.color ?? "gray";
  const active = FILTER_KEYS.filter((k) => filters[k]).length;
  const pages = list ? Math.max(1, Math.ceil(list.total / list.pageSize)) : 1;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <Link href={`/formularios/${id}`} aria-label="Voltar para o editor" title="Voltar" className="inline-flex size-9 shrink-0 items-center justify-center rounded-[12px] text-muted hover:bg-white hover:text-ink">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[24px] font-bold tracking-tight sm:text-[28px]">Respostas</h1>
            <p className="truncate text-[14px] text-muted">{form?.name ?? "…"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:[&>*]:grow">
          <a href={`/api/forms/${id}/export${qs({ ...filters, format: "csv" })}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-[12px] border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-page" download>
            <Download className="size-4" aria-hidden /> CSV
          </a>
          <a href={`/api/forms/${id}/export${qs({ ...filters, format: "xlsx" })}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-[12px] bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-hover" download>
            <Download className="size-4" aria-hidden /> Excel (XLSX)
          </a>
        </div>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            De
            <Input type="date" value={filters.from} onChange={(e) => setParams({ from: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            Até
            <Input type="date" value={filters.to} onChange={(e) => setParams({ to: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            Classificação
            <Select value={filters.tier} onChange={(e) => setParams({ tier: e.target.value })}>
              <option value="">Todas</option>
              {opts?.tiers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
              <option value="none">Sem classificação</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            Origem
            <Select value={filters.origin} onChange={(e) => setParams({ origin: e.target.value })}>
              <option value="">Todas</option>
              {opts?.origins.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            Responsável
            <Select value={filters.assignedTo} onChange={(e) => setParams({ assignedTo: e.target.value })}>
              <option value="">Todos</option>
              {opts?.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            Status comercial
            <Select value={filters.status} onChange={(e) => setParams({ status: e.target.value })}>
              <option value="">Todos</option>
              {Object.entries(LEAD_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            Score mínimo
            <Input type="number" min={0} max={100} value={filters.scoreMin} onChange={(e) => setParams({ scoreMin: e.target.value })} />
          </label>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            Score máximo
            <Input type="number" min={0} max={100} value={filters.scoreMax} onChange={(e) => setParams({ scoreMax: e.target.value })} />
          </label>
          <form
            className="flex flex-col gap-1 text-[12.5px] font-medium text-muted sm:col-span-2"
            onSubmit={(e) => {
              e.preventDefault();
              setParams({ q: search.trim() });
            }}
          >
            <label htmlFor="resp-q">Buscar</label>
            <Input id="resp-q" value={search} onChange={(e) => setSearch(e.target.value)} onBlur={() => search.trim() !== filters.q && setParams({ q: search.trim() })} placeholder="Nome, e-mail, WhatsApp, empresa" />
          </form>
          <label className="flex flex-col gap-1 text-[12.5px] font-medium text-muted">
            Envios repetidos
            <Select value={filters.duplicates || "hide"} onChange={(e) => setParams({ duplicates: e.target.value === "hide" ? "" : e.target.value })}>
              <option value="hide">Ocultar</option>
              <option value="show">Mostrar</option>
            </Select>
          </label>
          {active > 0 && (
            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                icon={<X className="size-4" />}
                onClick={() => {
                  setSearch("");
                  setParams(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
                }}
              >
                Limpar filtros
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Indicadores */}
      {statsError ? (
        <ErrorState error={statsError} />
      ) : !stats ? (
        <LoadingState rows={2} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 2xl:grid-cols-7">
            <Kpi i={0} icon={<Eye />} label="Visualizações" value={stats.views.toLocaleString("pt-BR")} />
            <Kpi i={1} icon={<Play />} label="Começaram" value={stats.starts.toLocaleString("pt-BR")} />
            <Kpi i={2} icon={<Inbox />} label="Concluíram" value={stats.completed.toLocaleString("pt-BR")} />
            <Kpi i={3} icon={<TrendingUp />} label="Taxa de conclusão" value={stats.starts ? pct(stats.completionRate) : "—"} />
            <Kpi i={4} icon={<Percent />} label="Conversão" value={stats.views ? pct(stats.conversionRate) : "—"} sub="Concluíram ÷ visualizaram" />
            <Kpi i={5} icon={<Gauge />} label="Score médio" value={stats.avgScore ?? "—"} />
            <Kpi i={6} icon={<Star />} label="Qualificados" value={stats.qualified.toLocaleString("pt-BR")} />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="p-5 lg:col-span-2">
              <h3 className="mb-4 text-[16px] font-semibold">Respostas por dia</h3>
              <DailyChart series={stats.series} />
            </Card>
            <Card className="p-5">
              <h3 className="mb-4 text-[16px] font-semibold">Classificação</h3>
              <BarList rows={stats.tiers} empty="Sem respostas classificadas." />
            </Card>
            <Card className="p-5">
              <h3 className="mb-4 text-[16px] font-semibold">Origem</h3>
              <BarList rows={stats.origins} />
            </Card>
            <Card className="p-5 lg:col-span-2">
              <details>
                <summary className="cursor-pointer text-[16px] font-semibold">Distribuição das respostas por pergunta</summary>
                <div className="mt-4 grid gap-6 md:grid-cols-2">
                  {stats.questions.map((q) => (
                    <div key={q.id}>
                      <p className="mb-3 text-[14px] font-medium">{q.title}</p>
                      <BarList rows={q.options} empty="Sem respostas." />
                    </div>
                  ))}
                </div>
              </details>
            </Card>
          </div>
        </>
      )}

      {/* Lista */}
      <Card className="p-4 sm:p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold">
            {list ? `${list.total.toLocaleString("pt-BR")} resposta${list.total === 1 ? "" : "s"}` : "Respostas"}
          </h2>
        </div>
        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading && !list ? (
          <LoadingState rows={4} />
        ) : !list?.rows.length ? (
          <EmptyState icon={<Inbox />} title={active ? "Nenhuma resposta com esses filtros" : "Nenhuma resposta ainda"} description={active ? "Ajuste ou limpe os filtros." : "Publique e compartilhe o link para começar a receber respostas."} />
        ) : (
          <>
            <div className="hidden overflow-x-auto scroll-thin md:block">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line text-[12.5px] text-muted">
                    <th className="py-2.5 pr-3 font-medium">Data</th>
                    <th className="px-3 py-2.5 font-medium">Pessoa</th>
                    <th className="px-3 py-2.5 text-right font-medium">Score</th>
                    <th className="px-3 py-2.5 font-medium">Classificação</th>
                    <th className="px-3 py-2.5 font-medium">Origem</th>
                    <th className="px-3 py-2.5 font-medium">Responsável</th>
                    <th className="py-2.5 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id} onClick={() => setParams({ resposta: r.id })} className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-page/60">
                      <td className="whitespace-nowrap py-3 pr-3 text-muted">{formatDateTime(r.completedAt)}</td>
                      <td className="max-w-[260px] px-3 py-3">
                        <button type="button" className="block max-w-full truncate text-left font-semibold hover:text-brand" onClick={(e) => (e.stopPropagation(), setParams({ resposta: r.id }))}>
                          {r.name ?? "Sem nome"}
                        </button>
                        <span className="block truncate text-[12.5px] text-muted">{r.email ?? r.phone ?? (r.instagram ? `@${r.instagram}` : "")}</span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold">{r.score ?? "—"}</td>
                      <td className="px-3 py-3">
                        <TierBadge label={r.tierLabel} color={tierColor(r.tierId)} />
                      </td>
                      <td className="px-3 py-3 text-muted">{r.origin}</td>
                      <td className="px-3 py-3 text-muted">{r.assignedName ?? "—"}</td>
                      <td className="py-3 pl-3 text-muted">{r.duplicateOf ? "Envio repetido" : r.leadStatus ? LEAD_STATUS_LABEL[r.leadStatus] : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col gap-2.5 md:hidden">
              {list.rows.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => setParams({ resposta: r.id })} className="w-full rounded-[18px] border border-line p-4 text-left">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{r.name ?? "Sem nome"}</span>
                        <span className="block text-[12.5px] text-muted">{formatDateTime(r.completedAt)}</span>
                      </span>
                      <span className="text-[20px] font-bold">{r.score ?? "—"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                      <TierBadge label={r.tierLabel} color={tierColor(r.tierId)} />
                      <span>{r.origin}</span>
                      {r.assignedName && <span>· {r.assignedName}</span>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
            {pages > 1 && (
              <div className="mt-4 flex items-center justify-end gap-2 text-[13.5px]">
                <IconButton size="sm" label="Página anterior" disabled={page <= 1} onClick={() => setParams({ pagina: String(page - 1) })}>
                  <ChevronLeft className="size-4" />
                </IconButton>
                <span>
                  Página {page} de {pages}
                </span>
                <IconButton size="sm" label="Próxima página" disabled={page >= pages} onClick={() => setParams({ pagina: String(page + 1) })}>
                  <ChevronRight className="size-4" />
                </IconButton>
              </div>
            )}
          </>
        )}
      </Card>

      <Sheet open={!!selected} onOpenChange={(v) => !v && setParams({ resposta: null })} title="Resposta" width={600}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="text-[15px] font-semibold">Resposta</span>
          <SheetClose asChild>
            <IconButton size="sm" label="Fechar">
              <X className="size-5" />
            </IconButton>
          </SheetClose>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin px-5 py-5">{selected && <SubmissionView id={selected} onOpenContact={(cid) => setParams({ resposta: null, contato: cid })} />}</div>
      </Sheet>
    </div>
  );
}
