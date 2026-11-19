"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ArrowRightLeft, Clock, Crown, Ellipsis, Flame, Headset, Megaphone, PhoneCall, Search, Send, Snowflake, SquarePen, SquareUser, UserRoundCheck, X } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import { buyingPowerLabel } from "@/lib/leadScore";
import { formatPhone, relativeTime } from "@/lib/format";
import { Avatar, Button, Card, cx, DemoBadge, Dialog, EmptyState, ErrorState, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, NoPermission, PageHeader } from "@/components/ui";
import { SourceChip } from "@/components/integrations/shared";
import { ForwardDialog } from "@/components/commercial/ForwardDialog";
import { LeadSheet } from "@/components/leads/LeadSheet";
import { SdrForwardDialog } from "./SdrForwardDialog";

export type CommunityStage = { id: string; key: string; name: string; color: string; position: number };
export type CommunityCard = {
  id: string;
  version: number;
  stageId: string;
  position: number;
  contactId: string;
  leadId: string | null;
  contactName: string;
  contactUsername: string | null;
  contactPhone: string | null;
  avatarUrl: string | null;
  /** Poder de compra informado no formulário; null = frio. */
  buyingPower: string | null;
  sourceName: string | null;
  sourceColor: string | null;
  createdAt: string;
  enteredStageAt: string | null;
  opportunityId: string | null;
  closerName: string | null;
  /** SDR dono do contato (Kanban do SDR). */
  sdrId: string | null;
  sdrName: string | null;
};
export type CommunityBoard = { pipelineId: string; stages: CommunityStage[]; cards: CommunityCard[] };

const SEND_HINT = "Envie leads pela aba Comunidade El Club em Leads.";
const LEADS_COMMUNITY_HREF = "/leads?status=comunidade";

export function TempBadge({ buyingPower }: { buyingPower: string | null }) {
  return buyingPower ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#fff1e6] px-2.5 py-0.5 text-[12px] font-semibold text-[#b54708]" title={buyingPowerLabel(buyingPower) ?? undefined}>
      <Flame className="size-3.5" aria-hidden /> Quente
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2.5 py-0.5 text-[12px] font-medium text-info" title="Não informou poder de compra">
      <Snowflake className="size-3.5" aria-hidden /> Frio
    </span>
  );
}

function CardBody({ card, menu }: { card: CommunityCard; menu?: React.ReactNode }) {
  const sub = card.contactUsername ? `@${card.contactUsername}` : card.contactPhone ? formatPhone(card.contactPhone) : "sem @";
  const since = card.enteredStageAt ?? card.createdAt;
  return (
    <>
      <div className="flex items-start gap-3">
        <Avatar name={card.contactName} src={card.avatarUrl} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-ink">{card.contactName}</p>
          <p className="truncate text-[13px] text-muted">{sub}</p>
        </div>
        {menu}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <TempBadge buyingPower={card.buyingPower} />
        {card.sourceName && <SourceChip name={card.sourceName} color={card.sourceColor} className="max-w-full !text-[12px]" />}
      </div>
      {card.buyingPower && <p className="mt-2 line-clamp-2 text-[12.5px] text-[#4b5b64]">{buyingPowerLabel(card.buyingPower)}</p>}
      {(card.closerName || card.sdrName) && (
        <p className="mt-2 flex flex-wrap gap-1.5">
          {card.closerName && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-selected px-2.5 py-0.5 text-[12px] font-medium text-brand" title={`Encaminhado ao closer ${card.closerName}`}>
              <UserRoundCheck className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">Com {card.closerName.split(" ")[0]}</span>
            </span>
          )}
          {card.sdrName && (
            <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-info-soft px-2.5 py-0.5 text-[12px] font-medium text-info" title={`No Kanban do SDR ${card.sdrName}`}>
              <Headset className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">SDR: {card.sdrName}</span>
            </span>
          )}
        </p>
      )}
      <p className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] text-muted" title="Tempo nesta etapa">
        <Clock className="size-3.5" aria-hidden />
        Nesta etapa {relativeTime(since).toLowerCase()}
      </p>
    </>
  );
}

type CardActions = {
  onOpen: (card: CommunityCard) => void;
  onOpenContact: (card: CommunityCard) => void;
  onForward: (card: CommunityCard) => void;
  onForwardSdr: (card: CommunityCard) => void;
  onRemove: (card: CommunityCard) => void;
  onMove: (card: CommunityCard, toStageId: string) => void;
};

function DraggableCard({ card, stages, actions }: { card: CommunityCard; stages: CommunityStage[]; actions: CardActions }) {
  const drag = useDraggable({ id: card.id, data: { card } });
  // O cartão também é alvo: soltar sobre ele coloca o arrastado logo acima (beforeId).
  const drop = useDroppable({ id: `card:${card.id}`, data: { stageId: card.stageId, beforeId: card.id } });
  return (
    <article
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      {...drag.attributes}
      {...drag.listeners}
      aria-roledescription="cartão arrastável"
      aria-label={`${card.contactName}. Pressione espaço para mover entre etapas ou use o menu.`}
      onClick={(e) => {
        if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("[data-no-open]")) return;
        actions.onOpen(card);
      }}
      onKeyDown={(e) => {
        if (!e.currentTarget.contains(e.target as Node) || (e.target as HTMLElement).closest("[data-no-open]")) return;
        drag.listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) actions.onOpen(card);
      }}
      className={cx(
        "relative cursor-grab touch-manipulation rounded-[20px] border-2 border-transparent bg-white p-4 shadow-[0_1px_2px_rgb(16_60_48/0.05)] transition-[border-color,opacity] hover:border-brand focus-visible:border-brand focus-visible:outline-none",
        drag.isDragging && "opacity-40",
        drop.isOver && !drag.isDragging && "before:absolute before:-top-2 before:left-3 before:right-3 before:h-1 before:rounded-full before:bg-brand",
      )}
    >
      <CardBody
        card={card}
        menu={
          <div data-no-open onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <Menu>
              <MenuTrigger asChild>
                <IconButton label={`Ações para ${card.contactName}`} size="sm" className="-mr-1 -mt-1 !size-10">
                  <Ellipsis className="size-5" />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Send />} onSelect={() => actions.onForward(card)}>
                  {card.closerName ? "Encaminhar para outro closer" : "Encaminhar para closer"}
                </MenuItem>
                {card.leadId && (
                  <MenuItem icon={<PhoneCall />} onSelect={() => actions.onForwardSdr(card)}>
                    {card.sdrName ? "Encaminhar para outro SDR" : "Encaminhar para SDR"}
                  </MenuItem>
                )}
                <MenuItem icon={<SquarePen />} onSelect={() => actions.onOpen(card)}>
                  Abrir lead
                </MenuItem>
                {card.leadId && (
                  <MenuItem icon={<SquareUser />} onSelect={() => actions.onOpenContact(card)}>
                    Abrir contato
                  </MenuItem>
                )}
                <MenuSub>
                  <MenuSubTrigger icon={<ArrowRightLeft />}>Mover para etapa</MenuSubTrigger>
                  <MenuSubContent>
                    <MenuLabel>Mover para</MenuLabel>
                    {stages.map((s) => (
                      <MenuItem key={s.id} disabled={s.id === card.stageId} onSelect={() => actions.onMove(card, s.id)}>
                        <span className="size-2 rounded-full" style={{ background: `var(--stage-${s.color}-dot)` }} aria-hidden />
                        {s.name}
                      </MenuItem>
                    ))}
                  </MenuSubContent>
                </MenuSub>
                <MenuSeparator />
                <MenuItem icon={<X />} danger onSelect={() => actions.onRemove(card)}>
                  Tirar do CRM da Comunidade
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        }
      />
    </article>
  );
}

function Column({ stage, cards, stages, actions }: { stage: CommunityStage; cards: CommunityCard[]; stages: CommunityStage[]; actions: CardActions }) {
  // Soltar na coluna (fora de um cartão) leva o cartão para o fim da etapa.
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stageId: stage.id, toEnd: true } });
  const c = stage.color;
  return (
    <section
      ref={setNodeRef}
      aria-label={`Etapa ${stage.name}, ${cards.length} lead(s)`}
      className={cx("flex w-[86vw] max-w-[300px] sm:w-[286px] shrink-0 snap-start flex-col rounded-[22px] p-3 transition-shadow", isOver && "ring-2 ring-brand")}
      style={{ background: `var(--stage-${c}-bg)` }}
    >
      <header className="flex items-center gap-2.5 px-2 pt-1.5 pb-3">
        <span className="size-3 rounded-full shrink-0" style={{ background: `var(--stage-${c}-dot)` }} aria-hidden />
        <h3 className="min-w-0 break-words text-[15px] font-semibold leading-tight text-ink">{stage.name}</h3>
        <span className="ml-auto flex shrink-0 min-w-7 h-7 items-center justify-center rounded-full px-2 text-[13px] font-semibold text-ink" style={{ background: `var(--stage-${c}-chip)` }}>
          {cards.length}
        </span>
      </header>
      <div className="flex min-h-[80px] flex-col gap-3">
        {cards.map((card) => (
          <DraggableCard key={card.id} card={card} stages={stages} actions={actions} />
        ))}
        {cards.length === 0 && <p className="rounded-[16px] border-2 border-dashed border-black/5 px-2 py-6 text-center text-[13px] text-muted">Arraste um lead para cá</p>}
      </div>
    </section>
  );
}

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** CRM da Comunidade (El Club): Kanban do administrador para os leads da comunidade low ticket. */
export function CommunityView() {
  const me = useMe();
  const allowed = me.permissions.dataAll;
  const openContact = useOpenContact();
  const [leadId, setLeadId] = useQueryParam("lead", "");
  const [q, setQ] = useState("");
  const debounced = useDebounced(q.trim());
  const key = allowed ? `/api/community${qs({ q: debounced })}` : null;
  const { data, error, isLoading, mutate } = useSWR<CommunityBoard>(key, fetcher, { keepPreviousData: true });
  const [active, setActive] = useState<CommunityCard | null>(null);
  const [forwarding, setForwarding] = useState<CommunityCard | null>(null);
  const [forwardingSdr, setForwardingSdr] = useState<CommunityCard | null>(null);
  const [removing, setRemoving] = useState<CommunityCard | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const stageName = useMemo(() => new Map(data?.stages.map((s) => [s.id, s.name]) ?? []), [data]);
  const byStage = useMemo(() => {
    const m = new Map<string, CommunityCard[]>();
    for (const c of data?.cards ?? []) m.set(c.stageId, [...(m.get(c.stageId) ?? []), c]);
    return m;
  }, [data]);

  /** Sem `beforeId`: `toEnd` leva para o fim da etapa; senão, para o topo. */
  const move = async (card: CommunityCard, toStageId: string, beforeId?: string, toEnd = false) => {
    if (!data) return;
    if (beforeId === card.id) return;
    const end = !beforeId && toEnd;
    if (card.stageId === toStageId && !beforeId && !end) return;
    if (end && card.stageId === toStageId && data.cards.filter((c) => c.stageId === toStageId).at(-1)?.id === card.id) return; // já é o último
    // Atualização otimista: tira o cartão e coloca antes de beforeId, no fim ou no topo da etapa de destino.
    const rest = data.cards.filter((c) => c.id !== card.id);
    const moved = { ...card, stageId: toStageId, version: card.version + 1, enteredStageAt: card.stageId === toStageId ? card.enteredStageAt : new Date().toISOString() };
    const idx = end ? -1 : beforeId ? rest.findIndex((c) => c.id === beforeId) : rest.findIndex((c) => c.stageId === toStageId);
    const cards = idx === -1 ? [...rest, moved] : [...rest.slice(0, idx), moved, ...rest.slice(idx)];
    mutate({ ...data, cards }, { revalidate: false });
    try {
      await api.post(`/api/community/entries/${card.id}/move`, { toStageId, beforeId, toEnd: end || undefined, expectedVersion: card.version });
      if (card.stageId !== toStageId) toast.success(`${card.contactName} → ${stageName.get(toStageId)}`);
      mutate();
    } catch (e) {
      const err = e as ApiError;
      mutate(data, { revalidate: true });
      if (err.status === 409 || err.code === "conflict") toast.warning(err.message || "Este cartão foi alterado por outra pessoa. O quadro foi atualizado.");
      else toast.error(`Não foi possível mover: ${err.message}`);
    }
  };

  const confirmRemove = async () => {
    if (!removing) return;
    setRemoveBusy(true);
    try {
      await api.del(`/api/community/entries/${removing.id}`);
      if (data) mutate({ ...data, cards: data.cards.filter((c) => c.id !== removing.id) }, { revalidate: true });
      toast.success(`${removing.contactName} saiu do CRM da Comunidade.`);
      setRemoving(null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRemoveBusy(false);
    }
  };

  const actions: CardActions = {
    onOpen: (c) => (c.leadId ? setLeadId(c.leadId) : openContact(c.contactId)),
    onOpenContact: (c) => openContact(c.contactId),
    onForward: setForwarding,
    onForwardSdr: setForwardingSdr,
    onRemove: setRemoving,
    onMove: (c, to) => void move(c, to),
  };

  const onDragStart = (e: DragStartEvent) => setActive((e.active.data.current as { card: CommunityCard }).card);
  const onDragEnd = (e: DragEndEvent) => {
    setActive(null);
    const card = (e.active.data.current as { card: CommunityCard }).card;
    const over = e.over?.data.current as { stageId: string; beforeId?: string; toEnd?: boolean } | undefined;
    if (!over) return;
    void move(card, over.stageId, over.beforeId, !!over.toEnd);
  };
  const overStage = (id: string | number | undefined, d: unknown) => (id === undefined ? undefined : stageName.get((d as { stageId?: string } | undefined)?.stageId ?? String(id)));
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Movendo ${(a.data.current as { card: CommunityCard }).card.contactName}. Use as setas para escolher a etapa e espaço para soltar.`,
    onDragOver: ({ over }) => (over ? `Sobre a etapa ${overStage(over.id, over.data.current)}.` : "Fora de uma etapa."),
    onDragEnd: ({ active: a, over }) => (over ? `${(a.data.current as { card: CommunityCard }).card.contactName} solto em ${overStage(over.id, over.data.current)}.` : "Movimento cancelado."),
    onDragCancel: () => "Movimento cancelado.",
  };

  const total = data?.cards.length ?? 0;
  const hot = data?.cards.filter((c) => c.buyingPower).length ?? 0;
  const forwarded = data?.cards.filter((c) => c.closerName).length ?? 0;

  if (!allowed) {
    return (
      <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
        <PageHeader title="CRM da Comunidade" />
        <Card>
          <NoPermission message="O CRM da Comunidade é só para administradores e gestores." />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <PageHeader
        title="CRM da Comunidade"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle="Leads da comunidade El Club. Encaminhe ao closer e ele recebe o lead com o selo Comunidade."
        actions={
          <Link href={LEADS_COMMUNITY_HREF} className="inline-flex h-[52px] items-center justify-center gap-2 rounded-[16px] bg-brand px-6 text-[16px] font-semibold text-white hover:bg-brand-hover">
            <Megaphone className="size-5" aria-hidden /> Enviar leads
          </Link>
        }
      />

      <div className="flex flex-col gap-3 rounded-[22px] border border-line/70 bg-white/60 p-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, @ ou WhatsApp..." aria-label="Buscar no CRM da Comunidade" className="h-12 w-full rounded-[14px] border border-line bg-white pl-11 pr-4 text-[14.5px] focus:border-brand focus:outline-none focus:ring-4 focus:ring-[#008a65]/10" />
        </div>
        {data && total > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[13.5px] text-muted">
            <span>
              <b className="font-semibold text-ink">{total}</b> lead{total === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1">
              <Flame className="size-3.5 text-[#b54708]" aria-hidden /> {hot} quente{hot === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1">
              <UserRoundCheck className="size-3.5 text-brand" aria-hidden /> {forwarded} com closer
            </span>
          </p>
        )}
      </div>

      {error && !data ? (
        <Card>
          {(error as ApiError).status === 403 ? <NoPermission message={(error as Error).message} /> : <ErrorState error={error} onRetry={() => mutate()} />}
        </Card>
      ) : isLoading && !data ? (
        <div className="flex gap-4 overflow-hidden" aria-busy="true" aria-label="Carregando">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[420px] w-[286px] shrink-0 rounded-[22px]" />
          ))}
        </div>
      ) : !data ? null : !data.stages.length ? (
        <Card>
          <EmptyState icon={<Crown />} title="O CRM da Comunidade ainda não tem etapas" description="Recarregue a página em instantes. Se continuar assim, fale com o suporte." />
        </Card>
      ) : total === 0 && !debounced ? (
        <Card>
          <EmptyState
            icon={<Crown />}
            title="Nenhum lead no CRM da Comunidade"
            description={`${SEND_HINT} Use "Enviar para o CRM da Comunidade" em cada lead ou selecione vários de uma vez.`}
            action={
              <Link href={LEADS_COMMUNITY_HREF} className="inline-flex h-11 items-center gap-2 rounded-[14px] bg-brand px-4 text-[14px] font-medium text-white hover:bg-brand-hover">
                <Megaphone className="size-4" aria-hidden /> Ir para Comunidade El Club
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {total === 0 && debounced && (
            <p className="text-[13.5px] text-muted" role="status">
              Nenhum lead encontrado para &quot;{debounced}&quot;.{" "}
              <button type="button" className="font-semibold text-brand hover:underline" onClick={() => setQ("")}>
                Limpar busca
              </button>
            </p>
          )}
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActive(null)} accessibility={{ announcements, screenReaderInstructions: { draggable: "Pressione espaço para pegar o cartão, setas para mover e espaço para soltar. Esc cancela." } }}>
            <div className="-mx-4 sm:mx-0 overflow-x-auto scroll-thin pb-3">
              <div className="flex snap-x snap-mandatory gap-4 px-4 sm:px-0 sm:snap-none items-start">
                {data.stages.map((s) => (
                  <Column key={s.id} stage={s} cards={byStage.get(s.id) ?? []} stages={data.stages} actions={actions} />
                ))}
              </div>
            </div>
            <DragOverlay dropAnimation={null}>
              {active && (
                <div className="w-[270px] rotate-[1.5deg] rounded-[20px] border-2 border-brand bg-white p-4 shadow-[var(--shadow-pop)]">
                  <CardBody card={active} />
                </div>
              )}
            </DragOverlay>
          </DndContext>
        </>
      )}

      {forwardingSdr?.leadId && (
        <SdrForwardDialog open onOpenChange={(v) => !v && setForwardingSdr(null)} leadId={forwardingSdr.leadId} contactName={forwardingSdr.contactName} currentSdrId={forwardingSdr.sdrId} onDone={() => mutate()} />
      )}
      {forwarding && <ForwardDialog open onOpenChange={(v) => !v && setForwarding(null)} contactId={forwarding.contactId} contactName={forwarding.contactName} onDone={() => mutate()} />}
      <Dialog
        open={!!removing}
        onOpenChange={(v) => !v && !removeBusy && setRemoving(null)}
        size="sm"
        title="Tirar do CRM da Comunidade?"
        description={removing ? `${removing.contactName} sai deste quadro. O contato, o lead e todo o histórico continuam no CRM.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)} disabled={removeBusy}>
              Cancelar
            </Button>
            <Button variant="danger" icon={<X className="size-4" />} loading={removeBusy} onClick={confirmRemove}>
              Tirar do quadro
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] text-muted">Se ele já foi encaminhado, continua no Comercial do closer, mas sem o selo Comunidade.</p>
      </Dialog>
      <LeadSheet leadId={leadId || null} onClose={() => setLeadId(null)} />
    </div>
  );
}
