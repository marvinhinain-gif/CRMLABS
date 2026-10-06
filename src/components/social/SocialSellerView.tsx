"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import * as Popover from "@radix-ui/react-popover";
import { Funnel, LayoutDashboard, MessageCircle, Plus, Search, Send, ShieldAlert, SlidersHorizontal, UserRound } from "lucide-react";
import { fetcher } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import type { Stage } from "@/lib/types";
import { Button, cx, DemoBadge, Field, PageHeader, Select, Tabs } from "@/components/ui";
import { KanbanBoard } from "./KanbanBoard";
import { EditStagesDialog } from "./EditStagesDialog";
import { LeadReviewDialog } from "./LeadReviewDialog";
import { AccountPill, useActiveAccount } from "./AccountPill";
import { NewContactDialog } from "@/components/contacts/NewContactDialog";
import { useRouter } from "next/navigation";

type Tab = "kanban" | "direct" | "comentarios";

export function SocialSellerView() {
  const me = useMe();
  const team = useTeam();
  const openContact = useOpenContact();
  const { account } = useActiveAccount();
  const [tab, setTab] = useQueryParam("aba", "kanban");
  const router = useRouter();
  // Direct e Comentários agora ficam em Instagram (links antigos continuam funcionando).
  useEffect(() => {
    if (tab === "direct") router.replace("/instagram?aba=directs");
    if (tab === "comentarios") router.replace("/instagram?aba=comentarios");
  }, [tab, router]);
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [stageId, setStageId] = useQueryParam("etapa", "");
  const [tagId, setTagId] = useQueryParam("tag", "");
  const [nextAction, setNextAction] = useQueryParam("acao", "");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [newStage, setNewStage] = useState<string | null | undefined>(undefined);
  const [editStages, setEditStages] = useState(false);
  const { data: stages } = useSWR<Stage[]>("/api/stages?kind=relationship", fetcher);
  const { data: tags } = useSWR<{ id: string; name: string }[]>("/api/tags", fetcher);
  const isAdmin = me.user.role === "admin";
  const { data: ig } = useSWR<{ autoLeadsToReview: number }>(isAdmin ? "/api/instagram" : null, fetcher);
  const [review, setReview] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const activeFilters = [stageId, tagId, nextAction].filter(Boolean).length;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <PageHeader
        title="Social Seller"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle="Transforme interações em relacionamentos."
        actions={
          <>
            <AccountPill />
            <Button size="lg" className="rounded-[16px]" icon={<Plus className="size-5" />} onClick={() => setNewStage(null)}>
              Novo contato
            </Button>
          </>
        }
      />
      <Tabs
        value={tab as Tab}
        onChange={(v) => (v === "kanban" ? setTab(v) : router.push(v === "direct" ? "/instagram?aba=directs" : "/instagram?aba=comentarios"))}
        items={[
          { value: "kanban", label: "Kanban", icon: <LayoutDashboard /> },
          { value: "direct", label: "Direct", icon: <Send /> },
          { value: "comentarios", label: "Comentários", icon: <MessageCircle /> },
        ]}
        className="self-start"
      />

      {tab === "kanban" && (
        <>
          {isAdmin && (ig?.autoLeadsToReview ?? 0) > 0 && (
            <div role="status" className="flex flex-col gap-3 rounded-[18px] border border-[#f1d9a6] bg-warning-soft px-4 py-3 text-[13.5px] text-[#6b4a00] sm:flex-row sm:items-center">
              <ShieldAlert className="hidden size-5 shrink-0 sm:block" aria-hidden />
              <p className="flex-1">
                <b className="font-semibold">{ig!.autoLeadsToReview} cartão(ões) entraram sozinhos no Kanban</b> só por mensagem ou comentário (regra antiga, já corrigida). Revise e decida quem continua como Lead — nada é apagado.
              </p>
              <Button size="sm" variant="secondary" className="shrink-0" onClick={() => setReview(true)}>
                Revisar
              </Button>
            </div>
          )}
          <div className="flex flex-col gap-3 rounded-[22px] border border-line/70 bg-white/60 p-3 sm:flex-row sm:items-center">
            <div className="relative sm:w-[260px]">
              <UserRound className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-ink" aria-hidden />
              <Select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="pl-11 h-12 bg-white" disabled={!me.permissions.dataAll}>
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
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no funil..." aria-label="Buscar no funil por nome ou @" className="h-12 w-full rounded-[14px] border border-line bg-white pl-11 pr-4 text-[14.5px] focus:border-brand focus:outline-none focus:ring-4 focus:ring-[#008a65]/10" />
            </div>
            <div className="flex gap-3">
              {me.permissions.pipelineEdit && (
                <Button variant="secondary" className="h-12 rounded-[14px] flex-1 sm:flex-none" icon={<SlidersHorizontal className="size-5" />} onClick={() => setEditStages(true)}>
                  Editar etapas
                </Button>
              )}
              <Popover.Root>
                <Popover.Trigger asChild>
                  <button className={cx("relative inline-flex size-12 items-center justify-center rounded-[14px] border border-line bg-white hover:bg-page", activeFilters && "border-brand text-brand")} aria-label={activeFilters ? `Filtros (${activeFilters} ativos)` : "Filtros"}>
                    <Funnel className="size-5" aria-hidden />
                    {activeFilters > 0 && <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">{activeFilters}</span>}
                  </button>
                </Popover.Trigger>
                <Popover.Portal>
                  <Popover.Content align="end" sideOffset={8} className="z-50 w-[300px] rounded-[18px] border border-line bg-white p-4 shadow-[var(--shadow-pop)] flex flex-col gap-3">
                    <Field label="Etapa" htmlFor="f-stage">
                      <Select id="f-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                        <option value="">Todas</option>
                        {stages?.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Tag" htmlFor="f-tag">
                      <Select id="f-tag" value={tagId} onChange={(e) => setTagId(e.target.value)}>
                        <option value="">Todas</option>
                        {tags?.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Próxima ação" htmlFor="f-next">
                      <Select id="f-next" value={nextAction} onChange={(e) => setNextAction(e.target.value)}>
                        <option value="">Qualquer</option>
                        <option value="today">Hoje</option>
                        <option value="overdue">Atrasada</option>
                        <option value="upcoming">Próximos dias</option>
                        <option value="none">Sem próxima ação</option>
                      </Select>
                    </Field>
                    {activeFilters > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setStageId(null);
                          setTagId(null);
                          setNextAction(null);
                        }}
                      >
                        Limpar filtros
                      </Button>
                    )}
                  </Popover.Content>
                </Popover.Portal>
              </Popover.Root>
            </div>
          </div>
          <KanbanBoard filters={{ q: debounced || undefined, ownerId: owner || undefined, stageId: stageId || undefined, tagId: tagId || undefined, nextAction: nextAction || undefined }} onAdd={(id) => setNewStage(id)} onEditStages={() => setEditStages(true)} />
        </>
      )}


      <NewContactDialog open={newStage !== undefined} onOpenChange={(v) => !v && setNewStage(undefined)} defaultStageId={newStage ?? undefined} onCreated={openContact} />
      <EditStagesDialog open={editStages} onOpenChange={setEditStages} />
      {isAdmin && <LeadReviewDialog open={review} onOpenChange={setReview} />}
    </div>
  );
}
