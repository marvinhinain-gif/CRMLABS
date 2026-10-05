"use client";

import { useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { CalendarCheck, CircleX, ListTodo, Plus, Settings2, Trophy } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { dayLabel, formatBRL, relativeTime } from "@/lib/format";
import { STAGE_TYPE_LABEL } from "@/lib/stageTypes";
import { Avatar, Button, Card, cx, EmptyState, ErrorState, LoadingState, Select } from "@/components/ui";
import { ScheduleDialog, type ScheduleValues } from "@/components/agenda/ScheduleDialog";
import { EditStagesDialog } from "@/components/social/EditStagesDialog";
import { CloseDealDialog, refreshCommercial } from "./OpportunitySheet";

export type CommercialCard = {
  id: string;
  title: string;
  valueCents: number;
  status: "open" | "won" | "lost";
  stageId: string;
  version: number;
  contactId: string;
  contactName: string;
  contactUsername: string | null;
  avatarUrl: string | null;
  product: string | null;
  closedAt: string | null;
  sellerName: string | null;
  sourceName: string | null;
  sourceColor: string | null;
  nextMeetingAt: string | null;
  nextTaskAt: string | null;
  openTasks: number;
  enteredStageAt: string | null;
  forwardedAt: string | null;
  createdAt: string;
};
type BoardStage = { id: string; key: string; name: string; color: string; position: number; stageType: string };
export type CommercialBoardData = { ownerId: string | null; pipelineId: string; canEdit: boolean; people: { id: string; name: string; role: string }[]; stages: BoardStage[]; cards: CommercialCard[] };

function CardBody({ c, dragging }: { c: CommercialCard; dragging?: boolean }) {
  const meetingSoon = c.nextMeetingAt && new Date(c.nextMeetingAt).getTime() > Date.now() - 2 * 3600_000;
  return (
    <div className={cx("rounded-[18px] border bg-white p-3.5 shadow-[0_1px_2px_rgb(16_60_48/0.05)] transition-shadow", dragging ? "border-brand shadow-[var(--shadow-pop)] rotate-[1.5deg]" : "border-transparent hover:border-brand")}>
      <div className="flex items-start gap-2.5">
        <Avatar name={c.contactName} src={c.avatarUrl} size={38} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-semibold">{c.contactName}</p>
          {(c.product || c.contactUsername) && <p className="truncate text-[12.5px] text-muted">{c.product ?? `@${c.contactUsername}`}</p>}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {c.sourceName && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium" style={{ background: `var(--stage-${c.sourceColor ?? "gray"}-chip)` }}>
            <span className="size-1.5 rounded-full" style={{ background: `var(--stage-${c.sourceColor ?? "gray"}-dot)` }} aria-hidden />
            {c.sourceName}
          </span>
        )}
        {meetingSoon && (
          <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[11.5px] font-medium text-info">
            <CalendarCheck className="size-3" aria-hidden /> {dayLabel(c.nextMeetingAt)}
          </span>
        )}
        {c.openTasks > 0 && (
          <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium", c.nextTaskAt && new Date(c.nextTaskAt).getTime() < Date.now() ? "bg-danger-soft text-danger" : "bg-page text-[#46565f]")}>
            <ListTodo className="size-3" aria-hidden /> {c.openTasks}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[12px] text-muted">
        <span className={cx("text-[14px] font-bold", c.status === "won" ? "text-brand" : "text-ink")}>{c.valueCents ? formatBRL(c.valueCents, true) : ""}</span>
        <span className="truncate">{c.sellerName ? `de ${c.sellerName.split(" ")[0]}` : ""}{c.enteredStageAt ? ` · ${relativeTime(c.enteredStageAt).toLowerCase()}` : ""}</span>
      </div>
    </div>
  );
}

function DraggableCard({ c, onOpen, disabled }: { c: CommercialCard; onOpen: () => void; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: c.id, disabled });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} role="button" tabIndex={0} aria-roledescription="cartão arrastável" aria-label={`${c.contactName}. Enter abre; espaço arrasta.`} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()} className={cx("touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-brand rounded-[18px]", isDragging && "opacity-30")}>
      <CardBody c={c} />
    </div>
  );
}

function Column({ s, cards, onOpen, canDrag }: { s: BoardStage; cards: CommercialCard[]; onOpen: (id: string) => void; canDrag: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: s.id });
  const total = cards.reduce((a, c) => a + c.valueCents, 0);
  const closed = s.stageType === "won" || s.stageType === "lost";
  return (
    <section ref={setNodeRef} aria-label={`Etapa ${s.name}`} className={cx("flex w-[84vw] max-w-[300px] sm:w-[284px] shrink-0 flex-col rounded-[22px] p-2.5 transition-shadow", isOver && "ring-2 ring-brand ring-offset-2")} style={{ background: `var(--stage-${s.color}-bg)` }}>
      <header className="px-1.5 pb-2.5 pt-1">
        <div className="flex items-center gap-2">
          {s.stageType === "won" ? <Trophy className="size-4 text-[#0c8f63]" aria-hidden /> : s.stageType === "lost" ? <CircleX className="size-4 text-muted" aria-hidden /> : <span className="size-2.5 rounded-full" style={{ background: `var(--stage-${s.color}-dot)` }} aria-hidden />}
          <h3 className="truncate text-[14.5px] font-semibold">{s.name}</h3>
          <span className="rounded-full px-2 text-[12px] font-semibold" style={{ background: `var(--stage-${s.color}-chip)` }}>
            {cards.length}
          </span>
          {total > 0 && <span className="ml-auto text-[12px] font-medium text-muted">{formatBRL(total, true)}</span>}
        </div>
        {s.stageType !== "custom" && <p className="mt-0.5 pl-[18px] text-[11px] text-muted">{closed ? "últimos 30 dias" : STAGE_TYPE_LABEL[s.stageType]}</p>}
      </header>
      <div className="flex min-h-[90px] flex-col gap-2.5">
        {cards.map((c) => (
          <DraggableCard key={c.id} c={c} onOpen={() => onOpen(c.id)} disabled={!canDrag} />
        ))}
        {!cards.length && <p className="rounded-[16px] border-2 border-dashed border-black/5 py-6 text-center text-[12.5px] text-muted">Arraste um lead para cá</p>}
      </div>
    </section>
  );
}

/** Kanban comercial do closer: colunas personalizáveis, arrastar e soltar, histórico de cada movimento. */
export function CommercialKanban({ onOpen, ownerParam, setOwnerParam }: { onOpen: (id: string) => void; ownerParam: string; setOwnerParam: (v: string) => void }) {
  const me = useMe();
  const { mutate: gm } = useSWRConfig();
  const key = `/api/commercial/board${qs({ ownerId: ownerParam })}`;
  const { data, error, isLoading, mutate } = useSWR<CommercialBoardData>(key, fetcher, { keepPreviousData: true });
  const [active, setActive] = useState<CommercialCard | null>(null);
  const [closing, setClosing] = useState<{ card: CommercialCard; stage: BoardStage } | null>(null);
  const [scheduleFor, setScheduleFor] = useState<CommercialCard | null>(null);
  const [editStages, setEditStages] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }), useSensor(KeyboardSensor));
  const byStage = useMemo(() => {
    const m = new Map<string, CommercialCard[]>();
    for (const c of data?.cards ?? []) m.set(c.stageId, [...(m.get(c.stageId) ?? []), c]);
    return m;
  }, [data]);

  const optimistic = (card: CommercialCard, stageId: string) => data && mutate({ ...data, cards: data.cards.map((c) => (c.id === card.id ? { ...c, stageId } : c)) }, { revalidate: false });

  const move = async (card: CommercialCard, stage: BoardStage, extra: Record<string, unknown> = {}) => {
    optimistic(card, stage.id);
    try {
      await api.patch(`/api/opportunities/${card.id}`, { stageId: stage.id, expectedVersion: card.version, ...extra });
      if (stage.stageType === "won") toast.success(`🎉 Venda de ${card.contactName} registrada!`);
      else toast.success(`${card.contactName} → ${stage.name}`);
      if (stage.stageType === "scheduled" && !(card.nextMeetingAt && new Date(card.nextMeetingAt).getTime() > Date.now())) setScheduleFor(card);
    } catch (e) {
      const err = e as ApiError;
      toast.error(err.message);
    }
    refreshCommercial(gm);
  };

  const onDragStart = (e: DragStartEvent) => setActive(data?.cards.find((c) => c.id === e.active.id) ?? null);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const card = data?.cards.find((c) => c.id === e.active.id);
    const stage = data?.stages.find((s) => s.id === e.over?.id);
    if (!card || !stage || card.stageId === stage.id) return;
    if ((stage.stageType === "won" || stage.stageType === "lost") && card.status === "open") return setClosing({ card, stage });
    void move(card, stage);
  };

  const book = async (v: ScheduleValues) => {
    if (!scheduleFor) return;
    await api.post("/api/appointments", { ...v, contactId: scheduleFor.contactId, opportunityId: scheduleFor.id, timezone: me.org.timezone });
    toast.success("Reunião marcada.");
    refreshCommercial(gm);
  };

  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (isLoading && !data) return <LoadingState rows={4} />;
  if (!data) return null;

  const owner = data.people.find((p) => p.id === data.ownerId);
  const open = data.cards.filter((c) => c.status === "open");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {data.people.length > 0 && (
          <Select aria-label="Kanban de" value={data.ownerId ?? ""} onChange={(e) => setOwnerParam(e.target.value)} className="h-10 w-auto min-w-[200px] bg-white">
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.role === "closer" ? `Closer: ${p.name}` : p.name}
              </option>
            ))}
          </Select>
        )}
        <p className="text-[13.5px] text-muted">
          {open.length} lead{open.length === 1 ? "" : "s"} em andamento · {formatBRL(open.reduce((a, c) => a + c.valueCents, 0), true)} em negociação
          {owner && data.people.length > 0 ? ` · ${owner.name}` : ""}
        </p>
        {data.canEdit && (
          <Button size="sm" variant="secondary" className="ml-auto" icon={<Settings2 className="size-4" />} onClick={() => setEditStages(true)}>
            Etapas
          </Button>
        )}
      </div>

      {data.stages.length === 0 ? (
        <Card>
          <EmptyState title="Nenhuma etapa" action={data.canEdit ? <Button onClick={() => setEditStages(true)}>Criar etapas</Button> : undefined} />
        </Card>
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)}>
          <div className="-mx-4 overflow-x-auto scroll-thin pb-4 sm:mx-0">
            <div className="flex items-start gap-3 px-4 sm:px-0">
              {data.stages.map((s) => (
                <Column key={s.id} s={s} cards={byStage.get(s.id) ?? []} onOpen={onOpen} canDrag={me.permissions.decide} />
              ))}
              {data.canEdit && (
                <button onClick={() => setEditStages(true)} className="flex h-[120px] w-[220px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-[22px] border-2 border-dashed border-line text-[14px] font-medium text-muted hover:border-brand hover:text-brand">
                  <Plus className="size-5" aria-hidden /> Nova etapa
                </button>
              )}
            </div>
          </div>
          <DragOverlay dropAnimation={{ duration: 180 }}>{active ? <div className="w-[270px]"><CardBody c={active} dragging /></div> : null}</DragOverlay>
        </DndContext>
      )}

      <CloseDealDialog
        mode={closing ? (closing.stage.stageType as "won" | "lost") : null}
        title={closing?.card.contactName ?? ""}
        valueCents={closing?.card.valueCents ?? 0}
        onClose={() => setClosing(null)}
        onConfirm={async (v) => {
          if (!closing) return;
          optimistic(closing.card, closing.stage.id);
          try {
            await api.patch(`/api/opportunities/${closing.card.id}`, { stageId: closing.stage.id, expectedVersion: closing.card.version, ...(closing.stage.stageType === "won" ? { wonValueCents: v.valueCents } : { lostReason: v.lostReason }) });
            toast.success(closing.stage.stageType === "won" ? `🎉 Venda de ${closing.card.contactName} registrada!` : "Perda registrada.");
          } finally {
            refreshCommercial(gm);
          }
        }}
      />
      <ScheduleDialog open={!!scheduleFor} onOpenChange={(v) => !v && setScheduleFor(null)} title="Agendar a reunião" subtitle={`${scheduleFor?.contactName ?? ""} entrou em reunião agendada. Quer marcar o horário agora?`} defaultTitle={`Reunião com ${scheduleFor?.contactName.split(" ")[0] ?? ""}`} defaultOwnerId={data.ownerId} submitLabel="Agendar" onSubmit={book} />
      <EditStagesDialog open={editStages} onOpenChange={setEditStages} kind="sales" ownerId={data.ownerId} />
    </div>
  );
}
