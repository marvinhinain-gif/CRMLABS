"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CalendarCheck, CalendarClock, CircleCheckBig, ListChecks, MessagesSquare, Phone, PhoneCall, SlidersHorizontal, SquarePen, ThumbsDown, UserRound } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { fillScript } from "@/lib/cadence";
import { formatPhone, relativeTime } from "@/lib/format";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import type { CadenceQueue, CadenceQueueItem, CadenceQueueView, CadenceStep } from "@/lib/types";
import { Avatar, Button, cx, EmptyState, ErrorState, LoadingState, Select, StageChip } from "@/components/ui";
import { WhatsAppButton } from "@/components/ui/WhatsApp";
import { CadenceDueChip, ChannelGlyph, messageFromScript, outcomeLabel, StatusPill } from "./cadenceUi";
import { EditCadenceDialog } from "./EditCadenceDialog";

const VIEWS: { value: CadenceQueueView; label: string; icon: React.ReactNode }[] = [
  { value: "due", label: "Para hoje", icon: <PhoneCall /> },
  { value: "upcoming", label: "Próximos", icon: <CalendarClock /> },
  { value: "responded", label: "Em conversa", icon: <MessagesSquare /> },
  { value: "scheduled", label: "Agendados", icon: <CalendarCheck /> },
  { value: "lost", label: "Sem interesse", icon: <ThumbsDown /> },
  { value: "finished", label: "Encerrados", icon: <CircleCheckBig /> },
  { value: "all", label: "Todos", icon: <ListChecks /> },
];

const EMPTY_TEXT: Record<CadenceQueueView, { title: string; description: string }> = {
  due: { title: "Nada para hoje", description: "Nenhum lead com passo da cadência para hoje ou atrasado. Veja os próximos ou inicie a cadência de novos leads pelo Kanban." },
  upcoming: { title: "Nenhum passo nos próximos dias", description: "Quando você registra um resultado, o próximo passo aparece aqui com a data." },
  responded: { title: "Ninguém em conversa", description: "Leads que atenderam ou responderam ficam aqui, com a cadência pausada." },
  scheduled: { title: "Nenhuma reunião agendada pela cadência", description: "Ao registrar \"Agendou reunião\", o lead aparece aqui." },
  lost: { title: "Nenhum lead sem interesse", description: "Leads marcados como \"Sem interesse\" ficam aqui." },
  finished: { title: "Nenhuma cadência encerrada", description: "Quando todos os passos são feitos sem resposta, o lead aparece aqui." },
  all: { title: "Nenhum lead em cadência", description: "" },
};

/** Fila da cadência do Social Seller: quem ligar/mandar mensagem hoje e o que já aconteceu. */
export function CadenceView() {
  const me = useMe();
  const team = useTeam();
  const openContact = useOpenContact();
  const [view, setView] = useQueryParam("fila", "due");
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [editing, setEditing] = useState(false);
  const current = (VIEWS.some((v) => v.value === view) ? view : "due") as CadenceQueueView;
  const key = `/api/cadence/queue${qs({ view: current, ownerId: owner || undefined })}`;
  const { data, error, isLoading, mutate } = useSWR<CadenceQueue>(key, fetcher, { keepPreviousData: true });
  const { data: stepsData } = useSWR<{ steps: CadenceStep[] }>("/api/cadence/steps", fetcher);
  const scripts = useMemo(() => new Map(stepsData?.steps.map((s) => [s.id, s.script]) ?? []), [stepsData]);

  const counts = data?.counts;
  const countFor = (v: CadenceQueueView) => {
    if (!counts) return undefined;
    if (v === "due") return counts.overdue + counts.today;
    if (v === "all") return counts.overdue + counts.today + counts.upcoming + counts.responded + counts.scheduled + counts.lost + counts.finished;
    return counts[v];
  };
  const nothingAtAll = counts && countFor("all") === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-[22px] border border-line/70 bg-white/60 p-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-[260px]">
          <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink" aria-hidden />
          <Select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="h-12 bg-white pl-11" disabled={!me.permissions.dataAll}>
            <option value="">{me.permissions.dataAll ? "Todos os responsáveis" : "Meus contatos"}</option>
            {me.permissions.dataAll &&
              team
                .filter((m) => m.status === "active")
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
          </Select>
        </div>
        <p className="flex-1 text-[13.5px] text-muted max-sm:hidden">Registre cada contato no lead e o próximo passo já fica agendado.</p>
        {me.permissions.pipelineEdit && (
          <Button variant="secondary" className="h-12 rounded-[14px]" icon={<SlidersHorizontal className="size-5" />} onClick={() => setEditing(true)}>
            Editar cadência
          </Button>
        )}
      </div>

      <div className="-mx-4 overflow-x-auto px-4 pb-1 scroll-thin sm:mx-0 sm:px-0" role="tablist" aria-label="Filtrar fila da cadência">
        <div className="flex w-max gap-2">
          {VIEWS.map((v) => {
            const active = v.value === current;
            const n = countFor(v.value);
            const overdue = v.value === "due" ? (counts?.overdue ?? 0) : 0;
            return (
              <button
                key={v.value}
                role="tab"
                type="button"
                aria-selected={active}
                onClick={() => setView(v.value)}
                className={cx(
                  "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium whitespace-nowrap transition-colors [&>svg]:size-[17px]",
                  active ? "border-[#c9ebdc] bg-selected text-brand" : "border-line bg-white text-ink hover:bg-page",
                )}
              >
                {v.icon}
                {v.label}
                {n !== undefined && <span className={cx("rounded-full px-2 text-[12px]", active ? "bg-white" : "bg-page")}>{n}</span>}
                {overdue > 0 && (
                  <span className="rounded-full bg-danger px-2 text-[12px] font-semibold text-white" title={`${overdue} atrasado(s)`}>
                    {overdue} atrasado{overdue > 1 ? "s" : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading && !data ? (
        <LoadingState rows={5} />
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-[22px] border border-line/70 bg-white">
          {nothingAtAll ? (
            <EmptyState
              icon={<PhoneCall />}
              title="Nenhum lead em cadência ainda"
              description="Para começar: abra o lead no Kanban, vá na aba Cadência e clique em Iniciar cadência (ou use o menu ··· do cartão). Ele aparece aqui com o passo do dia, o roteiro e os botões de Ligar e WhatsApp."
            />
          ) : (
            <EmptyState icon={<PhoneCall />} title={EMPTY_TEXT[current].title} description={EMPTY_TEXT[current].description} />
          )}
        </div>
      ) : (
        <ul className="flex flex-col gap-2.5" aria-label="Leads em cadência">
          {data.items.map((it) => (
            <QueueRow key={it.entryId} item={it} script={it.stepId ? scripts.get(it.stepId) : undefined} meName={me.user.name} onRegister={() => openContact(it.contactId, { tab: "cadencia" })} />
          ))}
          {data.items.length >= 200 && <li className="py-2 text-center text-[12.5px] text-muted">Mostrando os 200 primeiros. Use o filtro de responsável para ver menos.</li>}
        </ul>
      )}

      {me.permissions.pipelineEdit && <EditCadenceDialog open={editing} onOpenChange={setEditing} />}
    </div>
  );
}

function QueueRow({ item, script, meName, onRegister }: { item: CadenceQueueItem; script?: string; meName: string; onRegister: () => void }) {
  const waText = item.stepChannel === "whatsapp" && script ? messageFromScript(fillScript(script, { nome: item.name, responsavel: meName })) : undefined;
  return (
    <li className="rounded-[20px] border border-line/80 bg-white p-3.5 shadow-[0_1px_2px_rgb(16_60_48/0.05)] sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <button type="button" onClick={onRegister} className="flex min-w-0 items-center gap-3 text-left lg:w-[300px] lg:shrink-0">
          <Avatar name={item.name} src={item.avatarUrl} size={44} />
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold hover:text-brand">{item.name}</span>
            <span className="block truncate text-[13px] text-muted">{[item.username && `@${item.username}`, item.phone && formatPhone(item.phone)].filter(Boolean).join(" · ") || "Sem @ e sem telefone"}</span>
          </span>
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {item.status === "active" ? (
              <span className="inline-flex h-7 max-w-full items-center gap-1.5 rounded-full bg-[#eef2f1] px-2.5 text-[12.5px] font-medium text-[#24343d]">
                <ChannelGlyph channel={item.stepChannel} className="size-3.5" />
                <span className="truncate">
                  {item.stepIndex ?? "—"}/{item.stepCount} · {item.stepName ?? "Passo removido"}
                </span>
              </span>
            ) : (
              <StatusPill status={item.status} className="h-7 inline-flex items-center" />
            )}
            {item.status === "active" && <CadenceDueChip at={item.dueAt} />}
            <span className="max-sm:hidden">
              <StageChip name={item.stageName} color={item.stageColor} />
            </span>
          </div>
          <p className="truncate text-[12.5px] text-muted">
            {item.lastActivity ? (
              <>
                <span className="font-medium text-ink">{outcomeLabel(item.lastActivity.outcome)}</span>
                {item.lastActivity.note ? ` · “${item.lastActivity.note}”` : ""} · {item.lastActivity.actorName ?? "Automático"}, {relativeTime(item.lastActivity.at).toLowerCase()}
              </>
            ) : (
              "Nenhum registro ainda"
            )}
            {item.ownerName ? ` · Resp.: ${item.ownerName}` : ""}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 lg:flex lg:shrink-0">
          <a
            href={item.phone ? `tel:${item.phone}` : undefined}
            aria-disabled={!item.phone}
            aria-label={`Ligar para ${item.name}`}
            className={cx("inline-flex h-10 items-center justify-center gap-1.5 rounded-[12px] border border-line bg-white px-3 text-[14px] font-semibold hover:bg-page", !item.phone && "pointer-events-none opacity-45")}
          >
            <Phone className="size-[17px] shrink-0" aria-hidden /> Ligar
          </a>
          {item.phone ? (
            <WhatsAppButton phone={item.phone} name={item.name} text={waText} className="gap-1.5 px-2" />
          ) : (
            <span className="inline-flex h-10 items-center justify-center rounded-[12px] border border-dashed border-line px-2 text-[12.5px] text-muted">Sem tel.</span>
          )}
          <Button variant="soft" size="sm" className="h-10 px-3 text-[14px]" icon={<SquarePen className="size-4 shrink-0" />} onClick={onRegister}>
            Registrar
          </Button>
        </div>
      </div>
    </li>
  );
}

