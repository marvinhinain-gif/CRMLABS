"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Announcements,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { ArrowRightLeft, Clock, Ellipsis, MessageCircle, Plus, Send, SquarePen, UserRound, X } from "lucide-react";
import { ForwardDialog } from "@/components/commercial/ForwardDialog";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact } from "@/lib/nav";
import type { Board, BoardCard } from "@/lib/types";
import { dayLabel, dueTone, initials } from "@/lib/format";
import { Avatar, Button, cx, EmptyState, ErrorState, IconButton, LoadingState, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger } from "@/components/ui";

export type BoardFilters = { q?: string; ownerId?: string; tagId?: string; stageId?: string; nextAction?: string };

function DueChip({ at, action }: { at: string | null; action?: string | null }) {
  if (!at) return <span className="text-[12.5px] text-muted">{action ? action.slice(0, 28) : "Sem próxima ação"}</span>;
  const tone = dueTone(at);
  const cls = tone === "overdue" ? "bg-danger-soft text-danger" : tone === "today" ? "bg-success-soft text-success" : "bg-info-soft text-info";
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 h-8 text-[12.5px] font-medium whitespace-nowrap", cls)} title={`${tone === "overdue" ? "Próxima ação atrasada" : "Próxima ação"}${action ? `: ${action}` : ""}`}>
      <Clock className="size-4" aria-hidden />
      {action && <span className="sr-only">{action}: </span>}
      {tone === "overdue" ? `Atrasada · ${dayLabel(at)}` : dayLabel(at)}
    </span>
  );
}

function CardBody({ card, menu }: { card: BoardCard; menu?: React.ReactNode }) {
  return (
    <>
      <div className="flex items-start gap-3">
        <Avatar name={card.name} src={card.avatarUrl} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink">{card.name}</p>
          <p className="truncate text-[13px] text-muted">{card.username ? `@${card.username}` : "sem @"}</p>
        </div>
        {menu}
      </div>
      {card.summary && <p className="mt-2.5 line-clamp-2 text-[13.5px] text-[#4b5b64]">{card.summary}</p>}
      {card.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags.slice(0, 3).map((t) => (
            <span key={t.id} className="rounded-full bg-[#eef2f1] px-2 py-0.5 text-[11.5px] text-[#46565f]">
              {t.name}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <DueChip at={card.nextActionAt} action={card.nextAction} />
        <span className="ml-auto flex size-8 items-center justify-center rounded-full bg-[#eef2f1] text-[12px] font-semibold text-[#46565f]" title={card.ownerName ? `Responsável: ${card.ownerName}` : "Sem responsável"}>
          {card.ownerName ? initials(card.ownerName) : <UserRound className="size-4" aria-label="Sem responsável" />}
        </span>
        <span className="relative flex size-8 items-center justify-center text-ink" title={card.unread ? `${card.unread} mensagem(ns) não lida(s)` : "Sem mensagens não lidas"}>
          <MessageCircle className="size-[22px]" strokeWidth={1.8} aria-hidden />
          {card.unread > 0 && (
            <span className="absolute -right-1 -top-1 flex min-w-5 h-5 items-center justify-center rounded-full bg-[#0c8f63] px-1 text-[11px] font-semibold text-white ring-2 ring-white">
              {card.unread}
              <span className="sr-only"> não lidas</span>
            </span>
          )}
        </span>
      </div>
    </>
  );
}

function DraggableCard({ card, stages, onMove, onOpen, onRemove, onForward }: { card: BoardCard; stages: Board["stages"]; onMove: (card: BoardCard, toStageId: string) => void; onOpen: () => void; onRemove: () => void; onForward: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.entryId, data: { card } });
  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="cartão arrastável"
      aria-label={`${card.name}. Pressione espaço para mover entre etapas ou use o menu.`}
      onClick={(e) => {
        // Eventos de menus em portal também "borbulham" pelo React: ignore o que não está dentro do cartão.
        if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("[data-no-open]")) return;
        onOpen();
      }}
      onKeyDown={(e) => {
        if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("[data-no-open]")) return;
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) onOpen();
      }}
      className={cx(
        "cursor-grab touch-manipulation rounded-[20px] border-2 border-transparent bg-white p-4 shadow-[0_1px_2px_rgb(16_60_48/0.05)] transition-[border-color,opacity] hover:border-brand focus-visible:border-brand focus-visible:outline-none",
        isDragging && "opacity-40",
      )}
    >
      <CardBody
        card={card}
        menu={
          <div data-no-open onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={`Ações para ${card.name}`} size="sm" className="-mr-1 -mt-1">
                  <Ellipsis className="size-5" />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<SquarePen />} onSelect={onOpen}>
                  Abrir contato
                </MenuItem>
                <MenuSub>
                  <MenuSubTrigger icon={<ArrowRightLeft />}>Mover para etapa</MenuSubTrigger>
                  <MenuSubContent>
                    <MenuLabel>Mover para</MenuLabel>
                    {stages.map((s) => (
                      <MenuItem key={s.id} disabled={s.id === card.stageId} onSelect={() => onMove(card, s.id)}>
                        <span className="size-2 rounded-full" style={{ background: `var(--stage-${s.color}-dot)` }} aria-hidden />
                        {s.name}
                      </MenuItem>
                    ))}
                  </MenuSubContent>
                </MenuSub>
                <MenuItem icon={<Send />} onSelect={onForward}>
                  Encaminhar para Closer
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<X />} onSelect={onRemove}>
                  Remover do quadro
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        }
      />
    </article>
  );
}

function Column({
  stage,
  stages,
  filters,
  onMove,
  onOpen,
  onRemove,
  onForward,
  onAdd,
  onEditStages,
  canEdit,
}: {
  stage: Board["stages"][number];
  stages: Board["stages"];
  filters: BoardFilters;
  onMove: (card: BoardCard, toStageId: string) => void;
  onOpen: (contactId: string) => void;
  onRemove: (card: BoardCard) => void;
  onForward: (card: BoardCard) => void;
  onAdd: (stageId: string) => void;
  onEditStages: () => void;
  canEdit: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stage } });
  const [extra, setExtra] = useState<BoardCard[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const cards = [...stage.cards, ...extra.filter((e) => !stage.cards.some((c) => c.entryId === e.entryId) && e.stageId === stage.id)];
  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const more = await api.get<BoardCard[]>(`/api/board/column/${stage.id}${qs({ ...filters, offset: cards.length })}`);
      setExtra((x) => [...x, ...more]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  };
  const c = stage.color;
  return (
    <section
      ref={setNodeRef}
      aria-label={`Etapa ${stage.name}, ${stage.total} contato(s)`}
      className={cx("flex w-[86vw] max-w-[300px] sm:w-[286px] shrink-0 snap-start flex-col rounded-[22px] p-3 transition-shadow", isOver && "ring-2 ring-brand")}
      style={{ background: `var(--stage-${c}-bg)` }}
    >
      <header className="flex items-center gap-2.5 px-2 pt-1.5 pb-3">
        <span className="size-3 rounded-full shrink-0" style={{ background: `var(--stage-${c}-dot)` }} aria-hidden />
        <h3 className="min-w-0 break-words text-[15px] font-semibold leading-tight text-ink">{stage.name}</h3>
        <span className="flex shrink-0 min-w-7 h-7 items-center justify-center rounded-full px-2 text-[13px] font-semibold text-ink" style={{ background: `var(--stage-${c}-chip)` }}>
          {stage.total}
        </span>
        <Menu>
          <MenuTrigger asChild>
            <IconButton label={`Opções da etapa ${stage.name}`} size="sm" className="ml-auto shrink-0">
              <Ellipsis className="size-5" />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Plus />} onSelect={() => onAdd(stage.id)}>
              Adicionar contato
            </MenuItem>
            {canEdit && (
              <MenuItem icon={<SquarePen />} onSelect={onEditStages}>
                Editar etapas
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
      </header>
      <div className="flex min-h-[80px] flex-col gap-3">
        {cards.map((card) => (
          <DraggableCard key={card.entryId} card={card} stages={stages} onMove={onMove} onOpen={() => onOpen(card.contactId)} onRemove={() => onRemove(card)} onForward={() => onForward(card)} />
        ))}
        {cards.length === 0 && <p className="px-2 py-6 text-center text-[13px] text-muted">Nenhum contato nesta etapa.</p>}
        {cards.length < stage.total && (
          <Button variant="ghost" size="sm" loading={loadingMore} onClick={loadMore} className="bg-white/60">
            Carregar mais ({stage.total - cards.length})
          </Button>
        )}
      </div>
      <button
        onClick={() => onAdd(stage.id)}
        className="mt-3 flex h-12 items-center justify-center gap-2 rounded-[16px] border border-white/80 bg-white/70 text-[14.5px] font-medium text-brand hover:bg-white"
        style={{ color: c === "green" || c === "teal" ? "#008a65" : `var(--stage-${c}-dot)` }}
      >
        <Plus className="size-5" aria-hidden /> Adicionar contato
      </button>
    </section>
  );
}

/** Teclado: setas esquerda/direita saltam para a coluna vizinha (em vez de mover alguns pixels). */
const columnCoordinateGetter: KeyboardCoordinateGetter = (event, { context }) => {
  const { collisionRect, droppableRects, droppableContainers } = context;
  if (!collisionRect) return undefined;
  if (event.code !== "ArrowRight" && event.code !== "ArrowLeft") return undefined;
  event.preventDefault();
  const centerX = collisionRect.left + collisionRect.width / 2;
  const columns = droppableContainers
    .getEnabled()
    .map((c) => ({ id: c.id, rect: droppableRects.get(c.id) }))
    .filter((c): c is { id: typeof c.id; rect: NonNullable<typeof c.rect> } => !!c.rect)
    .sort((a, b) => a.rect.left - b.rect.left);
  const target =
    event.code === "ArrowRight"
      ? columns.find((c) => c.rect.left + c.rect.width / 2 > centerX + 10)
      : [...columns].reverse().find((c) => c.rect.left + c.rect.width / 2 < centerX - 10);
  if (!target) return undefined;
  return { x: target.rect.left + target.rect.width / 2 - collisionRect.width / 2, y: target.rect.top + 60 };
};

export function KanbanBoard({ filters, onAdd, onEditStages }: { filters: BoardFilters; onAdd: (stageId: string) => void; onEditStages: () => void }) {
  const key = `/api/board${qs(filters)}`;
  const { data, error, isLoading, mutate } = useSWR<Board>(key, fetcher, { keepPreviousData: true });
  const me = useMe();
  const openContact = useOpenContact();
  const [active, setActive] = useState<BoardCard | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinateGetter }),
  );
  const stageName = useMemo(() => new Map(data?.stages.map((s) => [s.id, s.name]) ?? []), [data]);

  const move = async (card: BoardCard, toStageId: string) => {
    if (!data || card.stageId === toStageId) return;
    // Atualização otimista com rollback em caso de erro.
    const optimistic: Board = {
      ...data,
      stages: data.stages.map((s) => {
        if (s.id === card.stageId) return { ...s, total: s.total - 1, cards: s.cards.filter((c) => c.entryId !== card.entryId) };
        if (s.id === toStageId) return { ...s, total: s.total + 1, cards: [{ ...card, stageId: toStageId, version: card.version + 1 }, ...s.cards] };
        return s;
      }),
    };
    mutate(optimistic, { revalidate: false });
    try {
      await api.post(`/api/board/entries/${card.entryId}/move`, { toStageId, expectedVersion: card.version });
      toast.success(`${card.name} → ${stageName.get(toStageId)}`);
      mutate();
    } catch (e) {
      const err = e as ApiError;
      mutate(data, { revalidate: true });
      if (err.code === "conflict") toast.warning(err.message);
      else toast.error(`Não foi possível mover: ${err.message}`);
    }
  };

  const [forwarding, setForwarding] = useState<BoardCard | null>(null);
  const remove = async (card: BoardCard) => {
    try {
      await api.del(`/api/board/entries/${card.entryId}`);
      toast.success(`${card.name} removido do quadro.`);
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as { card: BoardCard }).card);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const card = (e.active.data.current as { card: BoardCard }).card;
    if (e.over) move(card, String(e.over.id));
  };

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Movendo ${(a.data.current as { card: BoardCard }).card.name}. Use as setas para escolher a etapa e espaço para soltar.`,
    onDragOver: ({ over }) => (over ? `Sobre a etapa ${stageName.get(String(over.id))}.` : "Fora de uma etapa."),
    onDragEnd: ({ active: a, over }) => (over ? `${(a.data.current as { card: BoardCard }).card.name} solto em ${stageName.get(String(over.id))}.` : "Movimento cancelado."),
    onDragCancel: () => "Movimento cancelado.",
  };

  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (isLoading && !data)
    return (
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-[420px] w-[286px] shrink-0 rounded-[22px]" />
        ))}
      </div>
    );
  if (!data) return <LoadingState />;
  if (!data.stages.length) return <EmptyState title="Nenhuma etapa configurada" description="Um gestor ou administrador pode criar etapas em Editar etapas." />;

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)} accessibility={{ announcements, screenReaderInstructions: { draggable: "Pressione espaço para pegar o cartão, setas para mover e espaço para soltar. Esc cancela." } }}>
      <div className="-mx-4 sm:mx-0 overflow-x-auto scroll-thin pb-3">
        <div className="flex snap-x snap-mandatory gap-4 px-4 sm:px-0 sm:snap-none items-start">
          {data.stages.map((s) => (
            <Column key={s.id} stage={s} stages={data.stages} filters={filters} onMove={move} onOpen={openContact} onRemove={remove} onForward={setForwarding} onAdd={onAdd} onEditStages={onEditStages} canEdit={me.permissions.pipelineEdit} />
          ))}
        </div>
      </div>
      {forwarding && <ForwardDialog open onOpenChange={(v) => !v && setForwarding(null)} contactId={forwarding.contactId} contactName={forwarding.name} />}
      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-[270px] rotate-[1.5deg] rounded-[20px] border-2 border-brand bg-white p-4 shadow-[var(--shadow-pop)]">
            <CardBody card={active} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
