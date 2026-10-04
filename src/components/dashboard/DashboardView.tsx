"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import * as Popover from "@radix-ui/react-popover";
import { ArrowRight, Calendar, ChartNoAxesColumn, Info, MessageCircle, Plus, UserPlus, Ellipsis } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import { dayLabel, dueTone, formatBRL, relativeTime } from "@/lib/format";
import { Avatar, Button, Card, cx, DemoBadge, EmptyState, ErrorState, IconButton, LoadingState, Menu, MenuContent, MenuItem, MenuTrigger, PageHeader, Select, StageChip } from "@/components/ui";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";

type Task = { id: string; title: string; notes: string | null; dueAt: string | null; contactId: string | null; contactName: string | null };
type Dashboard = {
  metrics: { novosInteressados: number; conversasAtivas: number; reunioesAgendadas: number; vendasFechadasCents: number; vendasFechadasCount: number };
  distribution: { stageId: string; name: string; color: string; n: number }[];
  tasks: { today: Task[]; overdue: Task[]; counts: { today: number; overdue: number } };
  awaiting: { conversationId: string; contactId: string; contactName: string; avatarUrl: string | null; channel: string; preview: string | null; lastMessageAt: string | null; ownerName: string | null; stageName: string | null; stageColor: string | null }[];
};

const PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "Últimos 7 dias" },
  { value: "30d", label: "Últimos 30 dias" },
  { value: "month", label: "Este mês" },
  { value: "last_month", label: "Mês passado" },
];

function Metric({ icon, label, value, hint, href }: { icon: React.ReactNode; label: string; value: string; hint?: string; href: string }) {
  return (
    <Link href={href} className="group">
      <Card className="flex items-center gap-4 p-5 sm:p-6 h-full transition-shadow group-hover:shadow-[var(--shadow-pop)]">
        <span className="flex size-[60px] shrink-0 items-center justify-center rounded-[18px] bg-selected text-brand [&>svg]:size-7" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-ink">{label}</p>
          <p className="mt-0.5 text-[30px] font-bold leading-tight tracking-tight text-[#0f1f1a] truncate">{value}</p>
          {hint && <p className="text-[12px] text-muted">{hint}</p>}
        </div>
      </Card>
    </Link>
  );
}

export function DashboardView() {
  const me = useMe();
  const team = useTeam();
  const [period, setPeriod] = useQueryParam("periodo", "month");
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [newOpen, setNewOpen] = useState(false);
  const openContact = useOpenContact();
  const { data, error, isLoading, mutate } = useSWR<Dashboard>(`/api/dashboard${qs({ period, ownerId: owner })}`, fetcher, { keepPreviousData: true });

  const completeTask = async (id: string) => {
    try {
      await api.patch(`/api/tasks/${id}`, { status: "done" });
      toast.success("Tarefa concluída.");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const max = Math.max(1, ...(data?.distribution.map((d) => d.n) ?? [1]));
  const tasks = data ? [...data.tasks.overdue, ...data.tasks.today].slice(0, 4) : [];
  const allZero = data && Object.values(data.metrics).every((v) => v === 0) && data.distribution.every((d) => d.n === 0);
  const ownerQs = owner ? `&responsavel=${owner}` : "";

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-6">
      <PageHeader
        title="Dashboard"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle="Acompanhe sua operação e os próximos passos."
        actions={
          <>
            {me.permissions.dataAll && (
              <div className="w-[200px]">
              <Select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="bg-white h-[52px] rounded-[16px]">
                <option value="">Toda a equipe</option>
                {team
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </Select>
              </div>
            )}
            <div className="relative w-[190px]">
              <Calendar className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink" aria-hidden />
              <Select aria-label="Período" value={period} onChange={(e) => setPeriod(e.target.value)} className="bg-white pl-11 h-[52px] rounded-[16px] font-medium">
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="lg" icon={<Plus className="size-5" />} onClick={() => setNewOpen(true)} className="rounded-[16px]">
              Novo contato
            </Button>
          </>
        }
      />

      {error && !data ? (
        <Card>
          <ErrorState error={error} onRetry={() => mutate()} />
        </Card>
      ) : isLoading && !data ? (
        <LoadingState rows={4} />
      ) : data ? (
        <>
          {allZero && (
            <div className="rounded-[18px] border border-[#c9ebdc] bg-selected px-5 py-4 text-[14px] text-brand-dark">
              Ainda não há dados neste período. Cadastre contatos em <Link className="font-semibold underline" href="/social-seller">Social Seller</Link>
              {me.permissions.integrations && (
                <>
                  {" "}ou conecte o Instagram em <Link className="font-semibold underline" href="/configuracoes?aba=integracoes">Configurações</Link>
                </>
              )}
              . Os indicadores são calculados a partir de registros reais.
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 [&>*]:min-w-0">
            <Metric icon={<UserPlus />} label="Novos interessados" value={String(data.metrics.novosInteressados)} href={`/contatos?novos=${period}${ownerQs}`} />
            <Metric icon={<MessageCircle />} label="Conversas ativas" value={String(data.metrics.conversasAtivas)} href="/conversas" />
            <Metric icon={<Calendar />} label="Reuniões agendadas" value={String(data.metrics.reunioesAgendadas)} href="/comercial?aba=reunioes" />
            <Metric icon={<ChartNoAxesColumn />} label="Vendas fechadas" value={formatBRL(data.metrics.vendasFechadasCents, true)} hint="Valor negociado ganho (não é recebimento)" href="/comercial?aba=ganhas" />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.15fr_1fr] [&>*]:min-w-0">
            <Card className="p-6 sm:p-7">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[20px] font-semibold">Funil de relacionamento</h2>
                  <p className="text-[12.5px] text-muted">Posição atual · não usa o filtro de período</p>
                </div>
                <Popover.Root>
                  <Popover.Trigger asChild>
                    <IconButton label="Sobre este gráfico" size="sm">
                      <Info className="size-5" />
                    </IconButton>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content sideOffset={6} className="z-50 max-w-[280px] rounded-[14px] border border-line bg-white p-3 text-[13px] text-muted shadow-[var(--shadow-pop)]">
                      Quantidade de contatos em cada etapa agora. É uma fotografia do quadro, não uma taxa de conversão.
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </div>
              <ul className="mt-6 flex flex-col gap-4">
                {data.distribution.map((s, i) => {
                  const pct = (s.n / max) * 100;
                  const tones = ["#0c8f63", "#2dbb85", "#6fd3a8", "#9fe1c3", "#c4ecd9", "#d9f3e7", "#e4f6ee"];
                  return (
                    <li key={s.stageId}>
                      <Link href={`/social-seller?etapa=${s.stageId}`} className="grid grid-cols-[minmax(96px,190px)_1fr_32px] items-center gap-3 sm:gap-4 rounded-[10px] hover:bg-page/70">
                        <span className="text-[14.5px] leading-tight text-ink">{s.name}</span>
                        <span className="h-7 rounded-full bg-[#eef3f1] overflow-hidden" aria-hidden>
                          <span className="block h-full rounded-full" style={{ width: `${Math.max(pct, s.n ? 4 : 0)}%`, background: tones[Math.min(i, tones.length - 1)] }} />
                        </span>
                        <span className="text-right text-[15px] font-semibold">{s.n}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card className="p-6 sm:p-7 flex flex-col">
              <div className="flex items-center justify-between">
                <h2 className="text-[20px] font-semibold">Próximas ações</h2>
                <Link href="/tarefas" className="inline-flex items-center gap-1 text-[14px] font-medium text-brand hover:underline">
                  Ver tarefas <ArrowRight className="size-4" aria-hidden />
                </Link>
              </div>
              <p className="mt-1 text-[12.5px] text-muted">
                {data.tasks.counts.today} para hoje · <span className={cx(data.tasks.counts.overdue > 0 && "text-danger font-medium")}>{data.tasks.counts.overdue} atrasada(s)</span>
              </p>
              {tasks.length === 0 ? (
                <EmptyState title="Nada pendente para hoje" description="Crie tarefas a partir do painel de um contato." className="flex-1 py-6" />
              ) : (
                <ul className="mt-3 flex flex-col divide-y divide-line">
                  {tasks.map((t) => {
                    const tone = dueTone(t.dueAt);
                    return (
                      <li key={t.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 py-3.5">
                        <input type="checkbox" onChange={() => completeTask(t.id)} aria-label={`Concluir: ${t.title}`} className="mt-1 size-5 shrink-0 cursor-pointer rounded-[6px] accent-[#008a65]" />
                        <button className="min-w-0 flex-1 basis-[180px] text-left" onClick={() => t.contactId && openContact(t.contactId)} disabled={!t.contactId}>
                          <p className="text-[15px] font-semibold truncate">{t.title}</p>
                          <p className="text-[13px] text-muted truncate">{t.notes || t.contactName || "Sem contato vinculado"}</p>
                        </button>
                        <span className={cx("ml-8 sm:ml-0 inline-flex items-center gap-1.5 whitespace-nowrap text-[13.5px]", tone === "overdue" ? "text-danger font-medium" : "text-ink")}>
                          <Calendar className={cx("size-[18px]", tone === "overdue" ? "text-danger" : "text-brand")} aria-hidden />
                          {tone === "overdue" ? `Atrasada · ${dayLabel(t.dueAt)}` : dayLabel(t.dueAt)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <Link href="/tarefas" className="mt-auto pt-4">
                <span className="flex h-11 items-center justify-center gap-2 rounded-[14px] border border-[#c9ebdc] bg-selected text-[14.5px] font-semibold text-brand hover:brightness-[0.98]">
                  Ver todas as tarefas <ArrowRight className="size-4" aria-hidden />
                </span>
              </Link>
            </Card>
          </div>

          <Card className="p-6 sm:p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-[20px] font-semibold">Conversas que precisam de atenção</h2>
              <Link href="/conversas?filtro=awaiting" className="inline-flex items-center gap-1 text-[14px] font-medium text-brand hover:underline">
                Abrir conversas <ArrowRight className="size-4" aria-hidden />
              </Link>
            </div>
            {data.awaiting.length === 0 ? (
              <EmptyState icon={<MessageCircle />} title="Nenhuma conversa aguardando resposta" description="Mensagens recebidas pelo Instagram conectado aparecem aqui até alguém responder." />
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-left">
                  <thead>
                    <tr className="border-b border-line text-[13.5px] text-muted">
                      <th className="py-2.5 font-medium">Contato</th>
                      <th className="py-2.5 font-medium">Última mensagem</th>
                      <th className="py-2.5 font-medium">Etapa</th>
                      <th className="py-2.5 font-medium">Responsável</th>
                      <th className="py-2.5 w-10">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.awaiting.map((c) => (
                      <tr key={c.conversationId} className="border-b border-line last:border-0">
                        <td className="py-3.5">
                          <button onClick={() => openContact(c.contactId)} className="flex items-center gap-3 text-left">
                            <Avatar name={c.contactName} src={c.avatarUrl} size={44} />
                            <span className="text-[15px] font-semibold">{c.contactName}</span>
                            <InstagramGlyph size={20} className="ml-4 hidden sm:block" />
                          </button>
                        </td>
                        <td className="py-3.5">
                          <Link href={`/conversas?c=${c.conversationId}`} className="block hover:underline">
                            <span className="block text-[14.5px] max-w-[300px] truncate">{c.preview}</span>
                            <span className="block text-[13px] text-muted">{relativeTime(c.lastMessageAt)}</span>
                          </Link>
                        </td>
                        <td className="py-3.5">{c.stageName ? <StageChip name={c.stageName} color={c.stageColor} /> : <span className="text-muted text-[13px]">Fora do quadro</span>}</td>
                        <td className="py-3.5">
                          {c.ownerName ? (
                            <span className="flex items-center gap-2.5 text-[14.5px]">
                              <Avatar name={c.ownerName} size={36} tone="neutral" />
                              {c.ownerName}
                            </span>
                          ) : (
                            <span className="text-[13.5px] text-muted">Sem responsável</span>
                          )}
                        </td>
                        <td className="py-3.5">
                          <Menu>
                            <MenuTrigger asChild>
                              <IconButton label={`Ações para ${c.contactName}`} size="sm">
                                <Ellipsis className="size-5" />
                              </IconButton>
                            </MenuTrigger>
                            <MenuContent>
                              <MenuItem onSelect={() => (window.location.href = `/conversas?c=${c.conversationId}`)}>Responder</MenuItem>
                              <MenuItem onSelect={() => openContact(c.contactId)}>Abrir contato</MenuItem>
                            </MenuContent>
                          </Menu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
      <NewContactDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => openContact(id)} />
    </div>
  );
}
