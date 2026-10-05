"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ChartNoAxesColumn, CircleCheck, CircleX, FlaskConical, Pencil, Plug, Plus, ScrollText, Trash2 } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { formatBRL, formatDateTime, relativeTime } from "@/lib/format";
import { Badge, Button, Card, cx, Dialog, EmptyState, LoadingState, NoPermission, PageHeader, Select, Switch, Tabs, Textarea } from "@/components/ui";
import { CountUp } from "@/components/motion/CountUp";
import { IntegrationWizard } from "./IntegrationWizard";
import { ConnectGuide } from "./ConnectGuide";
import { GoogleCalendarSetup } from "./GoogleCalendarSetup";
import { PROVIDERS, ProviderIcon, providerOf, SourceChip, STATUS, useCatalog, type Integration, type ProviderId } from "./shared";

type TestResult = {
  ok: boolean;
  message: string;
  detected: Record<string, boolean>;
  values: Record<string, string | null>;
  custom: { label: string; value: string }[];
  answers: { label: string; value: string }[];
  utm: Record<string, string>;
  problems: string[];
  receivedKeys: string[];
};

const DETECT_LABEL: Record<string, string> = { nome: "Nome", telefone: "Telefone", email: "E-mail", instagram: "Instagram", origem: "Origem", utm: "UTM" };

function TestDialog({ integration, onClose }: { integration: Integration | null; onClose: () => void }) {
  const [sample, setSample] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!integration) return;
    let parsed: unknown = undefined;
    if (sample.trim()) {
      try {
        parsed = JSON.parse(sample);
      } catch {
        toast.error("O exemplo precisa ser JSON válido (ou deixe em branco).");
        return;
      }
    }
    setBusy(true);
    try {
      setResult(await api.post<TestResult>(`/api/lead-integrations/${integration.id}/test`, { sample: parsed }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!integration}
      onOpenChange={(o) => {
        if (!o) {
          onClose();
          setResult(null);
          setSample("");
        }
      }}
      title={`Testar · ${integration?.name ?? ""}`}
      description="Passa um lead de teste por todo o caminho e mostra o que foi reconhecido. Nada é criado no CRM."
      footer={
        <Button icon={<FlaskConical className="size-4" />} loading={busy} onClick={run}>
          {result ? "Testar de novo" : "Enviar lead de teste"}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <details className="text-[13px]">
          <summary className="cursor-pointer font-medium text-muted">Usar um exemplo próprio (JSON)</summary>
          <Textarea className="mt-2 font-mono text-[12.5px]" rows={6} value={sample} onChange={(e) => setSample(e.target.value)} placeholder={'{ "nome": "Maria", "whatsapp": "71999990000", "Qual seu faturamento?": "R$30 mil" }'} />
          <p className="mt-1 text-[12px] text-muted">Em branco, usamos o último envio recebido ou um exemplo padrão.</p>
        </details>
        {result && (
          <div className="anim-rise flex flex-col gap-3">
            <div className={cx("flex items-center gap-3 rounded-[16px] px-4 py-3", result.ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              {result.ok ? <CircleCheck className="anim-pop size-6 shrink-0" /> : <CircleX className="anim-pop size-6 shrink-0" />}
              <p className="text-[15px] font-semibold">{result.message}</p>
            </div>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {Object.entries(result.detected).map(([k, ok], i) => (
                <li key={k} className="anim-fade flex items-center gap-2 rounded-[12px] border border-line px-3 py-2 text-[14px]" style={{ "--i": i } as React.CSSProperties}>
                  {ok ? <CircleCheck className="size-4 text-success" aria-label="ok" /> : <CircleX className="size-4 text-muted" aria-label="não identificado" />}
                  {DETECT_LABEL[k] ?? k}
                </li>
              ))}
            </ul>
            {result.problems.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-[14px] bg-warning-soft px-4 py-3 text-[13.5px] text-[#6b4a00]">
                {result.problems.map((p) => (
                  <li key={p}>• {p}</li>
                ))}
              </ul>
            )}
            <dl className="grid gap-x-4 gap-y-2 rounded-[14px] bg-page/60 p-4 text-[13.5px] sm:grid-cols-2">
              {Object.entries(result.values)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[12px] capitalize text-muted">{k}</dt>
                    <dd className="break-words">{k === "horario" && v ? formatDateTime(v) : v}</dd>
                  </div>
                ))}
              {result.custom.map((c) => (
                <div key={c.label}>
                  <dt className="text-[12px] text-muted">{c.label}</dt>
                  <dd className="break-words">{c.value}</dd>
                </div>
              ))}
            </dl>
            {result.answers.length > 0 && (
              <p className="text-[12.5px] text-muted">
                {result.answers.length} resposta(s) guardada(s) no formulário do lead: {result.answers.map((a) => a.label).join(", ")}.
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}

function IntegrationCard({ i, idx, onEdit, onTest, onChanged, onRemoved }: { i: Integration; idx: number; onEdit: () => void; onTest: () => void; onChanged: (x: Integration) => void; onRemoved: () => void }) {
  const { data: cat } = useCatalog();
  const [open, setOpen] = useState(false);
  const st = STATUS[i.status];
  const src = cat?.sources.find((s) => s.id === i.sourceId);
  const product = cat?.products.find((p) => p.id === i.productId);
  const toggle = async (active: boolean) => {
    try {
      onChanged({ ...(await api.patch<Integration>(`/api/lead-integrations/${i.id}`, { active })), leadCount: i.leadCount });
      toast.success(active ? "Integração ativada." : "Integração desativada.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const remove = async () => {
    if (!confirm(`Excluir “${i.name}”? Os ${i.leadCount} lead(s) recebidos continuam no CRM.`)) return;
    try {
      await api.del(`/api/lead-integrations/${i.id}`);
      onRemoved();
      toast.success("Integração excluída.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <Card className="anim-rise p-4 sm:p-5" style={{ "--i": idx } as React.CSSProperties}>
      <div className="flex items-start gap-3">
        <ProviderIcon id={i.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[16.5px] font-semibold">{i.name}</h3>
            <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium", st.cls)}>
              <span className={cx("size-1.5 rounded-full", st.dot, i.status === "active" && "animate-[crm-pulse_2s_ease-in-out_infinite]")} aria-hidden />
              {st.label}
            </span>
          </div>
          <p className="mt-0.5 text-[13px] text-muted">{providerOf(i.provider).name}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            {src && <SourceChip name={src.name} color={src.color} />}
            {i.campaign && <span className="text-muted">Campanha: {i.campaign}</span>}
            {i.partner && <span className="text-muted">Parceiro: {i.partner}</span>}
            {product && <span className="text-muted">Produto: {product.name}</span>}
            <span className="text-muted">{i.pipelineKind === "sales" ? "→ Comercial" : "→ Social Seller"}</span>
          </div>
          <p className="mt-2 text-[13px]">
            {i.leadCount > 0 ? (
              <>
                <b>{i.leadCount}</b> {i.leadCount === 1 ? "lead" : "leads"}
                {i.lastLeadAt && ` · último ${relativeTime(i.lastLeadAt).toLowerCase()}`}
              </>
            ) : (
              "Nenhum lead ainda"
            )}
          </p>
          {i.status === "error" && i.lastError && <p className="mt-1 rounded-[12px] bg-danger-soft px-3 py-2 text-[12.5px] text-danger">{i.lastError}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-line pt-3">
        <Button size="sm" variant={open ? "soft" : "secondary"} icon={<Plug className="size-4" />} onClick={() => setOpen(!open)}>
          Como conectar
        </Button>
        <Button size="sm" variant="ghost" icon={<FlaskConical className="size-4" />} onClick={onTest}>
          Testar
        </Button>
        <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={onEdit}>
          Editar
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={remove}>
          Excluir
        </Button>
        <span className="ml-auto">
          <Switch checked={i.active} onChange={toggle} label={i.active ? "Ativa" : "Desativada"} />
        </span>
      </div>
      {open && (
        <div className="anim-fade mt-3 rounded-[18px] border border-line p-4">
          <ConnectGuide integration={i} onChanged={(x) => onChanged({ ...x, leadCount: i.leadCount })} />
        </div>
      )}
    </Card>
  );
}

type Log = { id: string; createdAt: string; integrationName: string | null; integrationId: string | null; event: string; result: "success" | "error"; message: string | null };

function LogsPanel({ integrations }: { integrations: Integration[] }) {
  const [filter, setFilter] = useState("");
  const { data } = useSWR<Log[]>(`/api/lead-integrations/logs${qs({ integrationId: filter })}`, fetcher, { refreshInterval: 15000 });
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
        <p className="text-[14px] text-muted">Últimos 100 eventos · atualiza sozinho</p>
        <Select aria-label="Integração" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-full bg-white sm:w-[260px]">
          <option value="">Todas as integrações</option>
          {integrations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
      </div>
      {!data ? (
        <LoadingState rows={4} className="p-4" />
      ) : data.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="Nenhum evento ainda" description="Cada lead recebido, teste ou erro aparece aqui." />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((l, i) => (
            <li key={l.id} className="anim-fade flex gap-3 px-4 py-3 sm:px-5" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
              {l.result === "success" ? <CircleCheck className="mt-0.5 size-5 shrink-0 text-success" aria-label="Sucesso" /> : <CircleX className="mt-0.5 size-5 shrink-0 text-danger" aria-label="Erro" />}
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">
                  <b>{l.event}</b> <span className="text-muted">· {l.integrationName ?? "Integração removida"}</span>
                </p>
                {l.message && <p className={cx("text-[13px]", l.result === "error" ? "text-danger" : "text-muted")}>{l.message}</p>}
              </div>
              <time className="shrink-0 text-[12.5px] text-muted">{formatDateTime(l.createdAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type MetricRow = { label: string; leads: number; people: number; qualified: number; calls: number; sales: number; revenueCents: number; conversion: number; avgTicketCents: number };
const BY = [
  { value: "source", label: "Origem" },
  { value: "campaign", label: "Campanha" },
  { value: "integration", label: "Formulário" },
  { value: "partner", label: "Collab / parceiro" },
  { value: "adName", label: "Conteúdo / anúncio" },
];

function OriginResults() {
  const [by, setBy] = useQueryParam("por", "source");
  const [days, setDays] = useQueryParam("dias", "90");
  const { data } = useSWR<MetricRow[]>(`/api/lead-integrations/metrics${qs({ by, days })}`, fetcher, { keepPreviousData: true });
  const max = Math.max(1, ...(data ?? []).map((r) => r.leads));
  const total = (data ?? []).reduce((a, r) => ({ leads: a.leads + r.leads, sales: a.sales + r.sales, revenue: a.revenue + r.revenueCents }), { leads: 0, sales: 0, revenue: 0 });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Agrupar por" value={by} onChange={(e) => setBy(e.target.value)} className="min-w-[180px] flex-1 bg-white sm:flex-none sm:w-[220px]">
          {BY.map((b) => (
            <option key={b.value} value={b.value}>
              Por {b.label.toLowerCase()}
            </option>
          ))}
        </Select>
        <Select aria-label="Período" value={days} onChange={(e) => setDays(e.target.value)} className="min-w-[150px] flex-1 bg-white sm:flex-none sm:w-[180px]">
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="365">Últimos 12 meses</option>
        </Select>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Leads", value: <CountUp value={total.leads} /> },
          { label: "Vendas", value: <CountUp value={total.sales} /> },
          { label: "Faturado", value: <CountUp value={total.revenue} format={(n) => formatBRL(Math.round(n), true)} /> },
        ].map((k, i) => (
          <Card key={k.label} className="anim-rise p-4" style={{ "--i": i } as React.CSSProperties}>
            <p className="text-[13px] text-muted">{k.label}</p>
            <p className="mt-0.5 truncate text-[22px] font-bold sm:text-[26px]">{k.value}</p>
          </Card>
        ))}
      </div>
      {!data ? (
        <LoadingState rows={4} />
      ) : data.length === 0 ? (
        <Card>
          <EmptyState icon={<ChartNoAxesColumn />} title="Sem leads no período" description="Os números aparecem assim que as integrações começarem a receber leads." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {data.map((r, i) => (
              <li key={r.label} className="anim-fade px-4 py-3.5 sm:px-5" style={{ "--i": i } as React.CSSProperties}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-[15px] font-semibold">{r.label}</p>
                  <p className="shrink-0 text-[15px] font-semibold">{formatBRL(r.revenueCents, true)}</p>
                </div>
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#eef3f1]" aria-hidden>
                  <div className="bar-grow h-full rounded-full bg-brand-accent" style={{ width: `${Math.max(3, (r.leads / max) * 100)}%`, "--i": i } as React.CSSProperties} />
                </div>
                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
                  <span>
                    <b className="text-ink">{r.leads}</b> leads
                  </span>
                  <span>
                    <b className="text-ink">{r.qualified}</b> qualificados
                  </span>
                  <span>
                    <b className="text-ink">{r.calls}</b> calls
                  </span>
                  <span>
                    <b className="text-ink">{r.sales}</b> vendas
                  </span>
                  <span>conversão {(r.conversion * 100).toFixed(1).replace(".", ",")}%</span>
                  {r.avgTicketCents > 0 && <span>ticket médio {formatBRL(r.avgTicketCents, true)}</span>}
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <p className="text-[12px] text-muted">Vendas e faturamento contam oportunidades ganhas depois da entrada do lead. Valores negociados, não recebimentos.</p>
    </div>
  );
}

export function IntegrationsView() {
  const me = useMe();
  const isAdmin = me.user.role === "admin";
  const { data, mutate } = useSWR<Integration[]>(isAdmin ? "/api/lead-integrations" : null, fetcher);
  const [tab, setTab] = useQueryParam("aba", "conectadas");
  const [wizard, setWizard] = useState<{ open: boolean; editing: Integration | null; provider: ProviderId | null }>({ open: false, editing: null, provider: null });
  const [testing, setTesting] = useState<Integration | null>(null);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  if (!isAdmin) return <NoPermission />;

  const replace = (x: Integration) => mutate((data ?? []).map((i) => (i.id === x.id ? { ...i, ...x } : i)), { revalidate: false });

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="Integrações"
        subtitle="Conecte suas fontes de leads ao CRMLABS."
        actions={
          <Button size="lg" icon={<Plus className="size-5" />} onClick={() => setWizard({ open: true, editing: null, provider: null })} className="rounded-[16px]">
            Nova integração
          </Button>
        }
      />
      <Tabs
        value={tab as "conectadas" | "resultados" | "logs"}
        onChange={(v) => setTab(v)}
        items={[
          { value: "conectadas", label: "Integrações", icon: <Plug />, count: data?.length },
          { value: "resultados", label: "Resultados por origem", icon: <ChartNoAxesColumn /> },
          { value: "logs", label: "Logs", icon: <ScrollText /> },
        ]}
        className="self-start"
      />
      {tab === "resultados" ? (
        <OriginResults />
      ) : tab === "logs" ? (
        <LogsPanel integrations={data ?? []} />
      ) : !data ? (
        <LoadingState rows={3} />
      ) : (
        <>
          {data.length > 0 && (
            <div className="flex flex-col gap-3">
              {data.map((i, idx) => (
                <div key={i.id} className={cx(justCreated === i.id && "rounded-[var(--radius-card)] ring-2 ring-brand ring-offset-2 ring-offset-page")}>
                  <IntegrationCard
                    i={i}
                    idx={idx}
                    onEdit={() => setWizard({ open: true, editing: i, provider: null })}
                    onTest={() => setTesting(i)}
                    onChanged={replace}
                    onRemoved={() => mutate()}
                  />
                </div>
              ))}
            </div>
          )}
          <section>
            <h2 className="mb-1 text-[17px] font-semibold">Formulários e quizzes</h2>
            <p className="mb-3 text-[13.5px] text-muted">Escolha de onde os leads vêm. Você pode ter várias integrações da mesma ferramenta (ex.: uma por origem).</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {PROVIDERS.map((p, i) => (
                <button key={p.id} onClick={() => setWizard({ open: true, editing: null, provider: p.id })} className="anim-rise lift flex items-start gap-3 rounded-[var(--radius-card)] border border-line/70 bg-white p-4 text-left shadow-[var(--shadow-soft)]" style={{ "--i": i } as React.CSSProperties}>
                  <ProviderIcon id={p.id} />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-semibold">{p.name}</span>
                    <span className="block text-[12.5px] text-muted">{p.description}</span>
                    <span className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-brand">
                      <Plus className="size-3.5" aria-hidden /> Conectar
                    </span>
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-[12.5px] text-muted">Outra ferramenta? Quase todas enviam por webhook — use o <b>Webhook CRMLABS</b>.</p>
          </section>
          {data.length === 0 && <Badge tone="info" className="self-start">Comece pelo Formulário CRMLABS ou pelo Webhook.</Badge>}
          <section>
            <h2 className="mb-3 text-[17px] font-semibold">Agenda</h2>
            <GoogleCalendarSetup />
          </section>
        </>
      )}
      <IntegrationWizard
        open={wizard.open}
        onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))}
        editing={wizard.editing}
        initialProvider={wizard.provider}
        onSaved={(x, created) => {
          if (created) {
            mutate([x, ...(data ?? [])], { revalidate: true });
            setTab("conectadas");
            setJustCreated(x.id);
            toast.success("Integração conectada! Abra “Como conectar” para ligar a ferramenta.");
            setTimeout(() => setJustCreated(null), 4000);
          } else {
            replace(x);
            toast.success("Integração salva.");
          }
        }}
      />
      <TestDialog integration={testing} onClose={() => setTesting(null)} />
    </div>
  );
}
