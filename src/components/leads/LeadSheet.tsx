"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Ban, CalendarCheck, CalendarClock, Check, ExternalLink, LayoutDashboard, Mail, MessageCircle, Phone, PhoneOff, Plus, Send, SquareUser, X } from "lucide-react";
import { ForwardDialog } from "@/components/commercial/ForwardDialog";
import { LeadTasks } from "@/components/tasks/TaskParts";
import { api, fetcher } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { formatDateTime, formatPhone, longDayTime, relativeTime, whatsappLink } from "@/lib/format";
import { Avatar, Button, cx, ErrorState, LoadingState, Select, Sheet, SheetClose } from "@/components/ui";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";
import { ScheduleDialog, type ScheduleValues } from "@/components/agenda/ScheduleDialog";
import { JourneySection, OriginTrail, type Journey } from "@/components/integrations/Journey";
import { LEAD_CLASS, LEAD_CLASSES, UNCLASSIFIED, type LeadClass } from "@/lib/leadScore";
import { ALL_SDRS, type ForwardToKanbanResult, type SdrBoard, type Stage } from "@/lib/types";

export const LEAD_STATUS = {
  new: { label: "Novo", cls: "bg-brand text-white" },
  contacted: { label: "Em contato", cls: "bg-info-soft text-info" },
  no_answer: { label: "Sem resposta", cls: "bg-warning-soft text-warning" },
  scheduled: { label: "Reunião marcada", cls: "bg-success-soft text-success" },
  disqualified: { label: "Descartado", cls: "bg-[#eef2f1] text-[#46565f]" },
} as const;

/** Selo do lead score por produto (com os pontos do quiz, quando houver). */
export function LeadClassBadge({ cls, score, manual, className }: { cls: LeadClass | null; score?: number | null; manual?: boolean; className?: string }) {
  const c = cls ? LEAD_CLASS[cls] : null;
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold", c ? c.cls : UNCLASSIFIED.cls, className)} title={manual ? "Classificação ajustada pela equipe" : cls ? "Classificação pelo quiz de aplicação" : "Sem classificação ainda"}>
      {c && <span className={cx("size-1.5 rounded-full", c.dot)} aria-hidden />}
      {c ? c.label : UNCLASSIFIED.label}
      {score != null && <span className="font-medium opacity-75">· {score} pts</span>}
    </span>
  );
}

const UTM_LABEL: Record<string, string> = {
  utm_source: "Origem",
  utm_medium: "Mídia",
  utm_campaign: "Campanha",
  utm_content: "Anúncio",
  utm_term: "Termo",
  campaign_name: "Campanha",
  adset_name: "Conjunto",
  ad_name: "Anúncio",
  platform: "Plataforma",
  form_name: "Formulário (Meta)",
};

type LeadDetail = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  status: keyof typeof LEAD_STATUS;
  answers: { label: string; value: string }[];
  preferredAt: string | null;
  preferredText: string | null;
  utm: Record<string, string>;
  channel: string;
  createdAt: string;
  contactedAt: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  formName: string | null;
  contactId: string;
  contact: { id: string; name: string; avatarUrl: string | null; username: string | null } | null;
  appointment: { id: string; startsAt: string; endsAt: string; status: string; title: string; ownerName: string | null; location: string | null } | null;
  previous: { id: string; createdAt: string; formName: string | null }[];
  source: { name: string; color: string } | null;
  productName: string | null;
  campaign: string | null;
  adChannel: string | null;
  partner: string | null;
  adName: string | null;
  customValues: { label: string; value: string }[];
  journey: Journey | null;
  leadScore: LeadScore;
  board: LeadBoard;
};

type LeadBoard = { inBoard: boolean; stageId: string | null; stageName: string | null; suggestedStageId: string | null; ownerId: string | null; ownerName: string | null; contatoStageId: string | null };

/** Kanban do SDR: o SDR encaminha o lead para o próprio Kanban (etapa Contato) e ele sai da fila de Leads.
 *  Gestores escolhem de quem é o Kanban e podem reencaminhar quem já está nele. */
function SdrKanbanCard({ leadId, b, onForwarded }: { leadId: string; b: LeadBoard; onForwarded: (r: ForwardToKanbanResult) => Promise<void> | void }) {
  const me = useMe();
  const canPick = me.permissions.assign;
  const { data: sdrs, error: sdrsError } = useSWR<SdrBoard[]>(canPick ? "/api/board/sdrs" : null, fetcher);
  const [sdrPicked, setSdrPicked] = useState<string | null>(null);
  const [stageOpen, setStageOpen] = useState(false);
  const { data: stages } = useSWR<Stage[]>(stageOpen ? "/api/stages?kind=relationship" : null, fetcher);
  const [stagePicked, setStagePicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Já no Kanban: o padrão do reencaminhamento é outro SDR (não faz sentido mandar para o mesmo dono).
  const defaultSdr = b.inBoard && b.ownerId === me.user.id ? (sdrs?.find((s) => s.userId !== me.user.id)?.userId ?? me.user.id) : me.user.id;
  const sdrId = sdrPicked ?? defaultSdr;
  const sdrName = sdrId === me.user.id ? null : (sdrs?.find((s) => s.userId === sdrId)?.name ?? "outro SDR");
  const stageId = stagePicked ?? b.contatoStageId ?? stages?.[0]?.id ?? "";
  const stageName = stages?.find((s) => s.id === stageId)?.name ?? (stagePicked ? "etapa escolhida" : "Contato");
  const sameOwner = b.inBoard && sdrId === b.ownerId && !stagePicked;

  const submit = async () => {
    setBusy(true);
    try {
      const body: { sdrId?: string; stageId?: string } = {};
      if (sdrId !== me.user.id) body.sdrId = sdrId;
      if (stagePicked || (stageOpen && stageId && stageId !== b.contatoStageId)) body.stageId = stageId;
      const r = await api.post<ForwardToKanbanResult>(`/api/leads/${leadId}/kanban`, body);
      await onForwarded(r);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const picker = canPick && (
    <div className="flex flex-col gap-1">
      <label htmlFor="lead-kanban-sdr" className="text-[12.5px] text-muted">
        Kanban de
      </label>
      <Select id="lead-kanban-sdr" value={sdrId} onChange={(e) => setSdrPicked(e.target.value)} disabled={!sdrs && !sdrsError}>
        {!sdrs?.some((s) => s.userId === me.user.id) && <option value={me.user.id}>{me.user.name} (você)</option>}
        {sdrs?.map((s) => (
          <option key={s.userId} value={s.userId}>
            {s.name}
            {s.userId === me.user.id ? " (você)" : ""}
          </option>
        ))}
      </Select>
      {sdrsError && <p className="text-[12.5px] text-danger">Não foi possível carregar a equipe. Você ainda pode encaminhar para o seu Kanban.</p>}
    </div>
  );
  const stagePicker = stageOpen ? (
    <div className="flex flex-col gap-1">
      <label htmlFor="lead-kanban-stage" className="text-[12.5px] text-muted">
        Etapa
      </label>
      <Select id="lead-kanban-stage" value={stageId} onChange={(e) => setStagePicked(e.target.value)} disabled={!stages}>
        {!stages && <option value={stageId}>Carregando etapas...</option>}
        {stages?.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </Select>
    </div>
  ) : (
    <button type="button" className="min-h-11 self-start text-[13px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setStageOpen(true)}>
      Colocar em outra etapa
    </button>
  );
  const label = sdrName ? `Encaminhar para o Kanban de ${sdrName.split(" ")[0]}` : b.inBoard ? "Trazer para o meu Kanban" : "Encaminhar para o meu Kanban";

  if (b.inBoard) {
    return (
      <div className="mt-4 flex flex-col gap-2">
        <Link href={`/social-seller?responsavel=${b.ownerId ?? ALL_SDRS}`} className="flex items-center gap-3 rounded-[18px] border border-[#c9ebdc] bg-selected p-4 hover:brightness-[0.99]">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-white text-brand" aria-hidden>
            <LayoutDashboard className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-semibold text-brand-dark">{b.ownerName ? `Em contato com ${b.ownerId === me.user.id ? "você" : b.ownerName.split(" ")[0]}` : "No Kanban (sem responsável)"}</span>
            <span className="block truncate text-[12.5px] text-brand-dark/80">Etapa: {b.stageName}</span>
          </span>
          <ExternalLink className="size-4 shrink-0 text-brand" aria-hidden />
        </Link>
        {canPick && (
          <details className="rounded-[18px] border border-line px-4 py-1">
            <summary className="flex min-h-11 cursor-pointer items-center text-[13.5px] font-medium text-ink">Reencaminhar para outro SDR</summary>
            <div className="flex flex-col gap-2 pb-3">
              {picker}
              {stagePicker}
              <Button variant="secondary" loading={busy} disabled={sameOwner} icon={<Send className="size-4" />} onClick={submit}>
                {label}
              </Button>
            </div>
          </details>
        )}
      </div>
    );
  }
  return (
    <section className="mt-4 rounded-[18px] border border-line p-4" aria-labelledby="lead-kanban-title">
      <h3 id="lead-kanban-title" className="text-[13px] font-semibold uppercase tracking-wide text-muted">
        Kanban do SDR
      </h3>
      <p className="mt-1 text-[13px] text-muted">Encaminhe para o Kanban e o lead sai de &quot;Para atender&quot;: ele entra em {stageOpen ? stageName : "Contato"} e você segue por lá.</p>
      <div className="mt-3 flex flex-col gap-2">
        {picker}
        <Button loading={busy} disabled={stageOpen && !stageId} icon={<LayoutDashboard className="size-4" />} onClick={submit}>
          {label}
        </Button>
        {stagePicker}
      </div>
    </section>
  );
}

/** CRM do Social Seller (quem não é SDR, ex.: closer): o lead do formulário só entra no Kanban por este botão. */
function BoardCard({ b, busy, onAdd }: { b: LeadBoard; busy: boolean; onAdd: (stageId: string) => void }) {
  const { data: stages } = useSWR<Stage[]>(b.inBoard ? null : "/api/stages?kind=relationship", fetcher);
  const [picked, setPicked] = useState<string | null>(null);
  const stageId = picked ?? b.suggestedStageId ?? stages?.[0]?.id ?? "";
  if (b.inBoard) {
    return (
      <Link href="/social-seller" className="mt-4 flex items-center gap-3 rounded-[18px] border border-[#c9ebdc] bg-selected p-4 hover:brightness-[0.99]">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-white text-brand" aria-hidden>
          <LayoutDashboard className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14.5px] font-semibold text-brand-dark">No CRM do Social Seller</span>
          <span className="block truncate text-[12.5px] text-brand-dark/80">Etapa: {b.stageName}</span>
        </span>
        <ExternalLink className="size-4 text-brand" aria-hidden />
      </Link>
    );
  }
  return (
    <section className="mt-4 rounded-[18px] border border-line p-4" aria-labelledby="lead-board-title">
      <h3 id="lead-board-title" className="text-[13px] font-semibold uppercase tracking-wide text-muted">
        CRM do Social Seller
      </h3>
      <p className="mt-1 text-[13px] text-muted">Este lead ainda não está no Kanban. Ele só entra quando você adicionar.</p>
      <div className="mt-3 flex flex-col gap-2">
        <Select aria-label="Etapa do Kanban" value={stageId} onChange={(e) => setPicked(e.target.value)} disabled={!stages}>
          {stages?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Button variant="secondary" loading={busy} disabled={!stageId} icon={<Plus className="size-4" />} onClick={() => onAdd(stageId)}>
          Adicionar ao CRM do Social Seller
        </Button>
      </div>
    </section>
  );
}

type LeadScore = {
  class: LeadClass | null;
  auto: LeadClass | null;
  manual: { byName: string | null; at: string } | null;
  application: { id: string; formId: string; formTitle: string; score: number | null; tierLabel: string | null; productLabel: string | null; needsReview: boolean; completedAt: string } | null;
};

/** Lead score por produto: classe valendo, de onde veio e troca manual. */
function LeadScoreCard({ s, busy, onSet, isAdmin }: { s: LeadScore; busy: string | null; onSet: (c: LeadClass | null) => void; isAdmin: boolean }) {
  const app = s.application;
  return (
    <section className="mt-4 rounded-[18px] border border-line p-4" aria-labelledby="lead-score-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="lead-score-title" className="text-[13px] font-semibold uppercase tracking-wide text-muted">
          Lead score
        </h3>
        <LeadClassBadge cls={s.class} manual={!!s.manual} className="text-[13px]" />
      </div>
      {app ? (
        <div className="mt-3 flex items-center gap-3">
          {app.score != null && (
            <span className="flex size-14 shrink-0 flex-col items-center justify-center rounded-[16px] bg-page leading-none">
              <span className="text-[20px] font-semibold">{app.score}</span>
              <span className="mt-0.5 text-[11px] text-muted">de 100</span>
            </span>
          )}
          <span className="min-w-0 text-[13px] text-muted">
            {app.tierLabel && <span className="block text-[14px] font-medium text-ink">{app.tierLabel}</span>}
            Sugestão do quiz: <span className="font-medium text-ink">{app.productLabel ?? "sem sugestão"}</span>
            <span className="block truncate">
              {isAdmin ? (
                <Link href={`/formularios/${app.formId}/respostas?resposta=${app.id}`} className="text-brand hover:underline">
                  {app.formTitle}
                </Link>
              ) : (
                app.formTitle
              )}{" "}
              · {relativeTime(app.completedAt)}
            </span>
          </span>
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-muted">Este lead ainda não respondeu o quiz de aplicação. Classifique depois da conversa.</p>
      )}
      {!s.manual && !s.class && app?.needsReview && <p className="mt-2 rounded-[12px] bg-warning-soft px-3 py-2 text-[12.5px] text-warning">O quiz pediu análise da equipe: escolha a classificação abaixo.</p>}
      {s.manual && (
        <p className="mt-2 text-[12.5px] text-muted">
          Ajustado {s.manual.byName ? `por ${s.manual.byName} ` : ""}
          {relativeTime(s.manual.at)}.{" "}
          <button type="button" className="font-medium text-brand hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => onSet(null)}>
            Voltar para a classificação do quiz{s.auto ? ` (${LEAD_CLASS[s.auto].label})` : ""}
          </button>
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Classificar lead">
        {LEAD_CLASSES.map((c) => {
          const active = s.class === c;
          return (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={!!busy}
              onClick={() => !active && onSet(c)}
              className={cx("flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-[12px] border px-2 py-1.5 text-center text-[12.5px] leading-tight sm:gap-2 sm:text-[13px] font-medium transition-colors disabled:opacity-60", active ? cx("border-transparent", LEAD_CLASS[c].cls) : "border-line bg-white text-ink hover:bg-page")}
            >
              <span className={cx("size-2 shrink-0 rounded-full", LEAD_CLASS[c].dot)} aria-hidden />
              <span>{LEAD_CLASS[c].label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-[14.5px] text-ink">{children}</dd>
    </div>
  );
}

function Body({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useMe();
  const team = useTeam();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: l, error, mutate } = useSWR<LeadDetail>(`/api/leads/${id}`, fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [forwarding, setForwarding] = useState(false);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} className="p-6" />;
  if (!l) return <LoadingState rows={6} className="p-6" />;

  const refresh = async () => {
    await mutate();
    await globalMutate((k) => typeof k === "string" && (k.startsWith("/api/leads") || k.startsWith("/api/me") || k.startsWith("/api/agenda")));
  };
  const patch = async (body: Record<string, unknown>, msg: string, key: string) => {
    setBusy(key);
    try {
      await api.patch(`/api/leads/${l.id}`, body);
      await refresh();
      toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const schedule = async (v: ScheduleValues) => {
    await api.post(`/api/leads/${l.id}/schedule`, v);
    await refresh();
    toast.success("Reunião confirmada! Ela já aparece em Agendamentos.");
  };

  const first = l.name.split(" ")[0];
  const wa = whatsappLink(l.phone, `Olá, ${first}! Aqui é ${me.user.name.split(" ")[0]}, da ${me.org.name}. Recebi seu cadastro e quero combinar um horário para conversarmos.`);
  const st = LEAD_STATUS[l.status];
  const utm = Object.entries(l.utm ?? {});
  const open = l.status !== "scheduled" && l.status !== "disqualified";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-5 sm:px-6">
        <Avatar name={l.name} src={l.contact?.avatarUrl} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] font-semibold leading-tight">{l.name}</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {l.formName ?? (l.channel === "webhook" ? "Recebido por integração" : "Formulário removido")} · {relativeTime(l.createdAt)}
          </p>
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={cx("rounded-full px-2.5 py-0.5 text-[12px] font-medium", st.cls)}>{st.label}</span>
            <LeadClassBadge cls={l.leadScore.class} score={l.leadScore.application?.score} manual={!!l.leadScore.manual} />
          </span>
        </div>
        <SheetClose asChild>
          <button className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page" aria-label="Fechar" onClick={onClose}>
            <X className="size-5" />
          </button>
        </SheetClose>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
        {/* Contato rápido */}
        <div className="grid grid-cols-3 gap-2">
          <a
            href={wa ?? undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!wa}
            onClick={() => wa && l.status === "new" && patch({ status: "contacted" }, "Marcado como em contato.", "auto")}
            className={cx("flex flex-col items-center gap-1 rounded-[16px] border px-2 py-3 text-[13px] font-medium transition-colors", wa ? "border-[#bfe8d3] bg-[#e9f9f1] text-[#0f7a4f] hover:brightness-[0.98]" : "pointer-events-none border-line text-muted opacity-50")}
          >
            <MessageCircle className="size-5" aria-hidden /> WhatsApp
          </a>
          <a href={l.phone ? `tel:${l.phone}` : undefined} aria-disabled={!l.phone} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line bg-white px-2 py-3 text-[13px] font-medium hover:bg-page", !l.phone && "pointer-events-none opacity-50")}>
            <Phone className="size-5" aria-hidden /> Ligar
          </a>
          <a href={l.email ? `mailto:${l.email}` : undefined} aria-disabled={!l.email} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line bg-white px-2 py-3 text-[13px] font-medium hover:bg-page", !l.email && "pointer-events-none opacity-50")}>
            <Mail className="size-5" aria-hidden /> E-mail
          </a>
        </div>

        <LeadScoreCard
          s={l.leadScore}
          busy={busy}
          isAdmin={me.user.role === "admin"}
          onSet={(c) => patch({ scoreClass: c }, c ? `Lead classificado como ${LEAD_CLASS[c].label}.` : "Classificação do quiz restaurada.", "score")}
        />

        {me.user.role !== "closer" ? (
          <SdrKanbanCard
            leadId={l.id}
            b={l.board}
            onForwarded={async (r) => {
              toast.success(`Lead encaminhado para o ${r.sdrId === me.user.id ? "seu Kanban" : `Kanban de ${r.sdrName}`}, em ${r.stageName}.`);
              onClose();
              await globalMutate((k) => typeof k === "string" && (k.startsWith("/api/leads") || k.startsWith("/api/me") || k.startsWith("/api/board") || k.startsWith("/api/contacts")));
            }}
          />
        ) : (
          <BoardCard
            b={l.board}
            busy={busy === "board"}
            onAdd={async (stageId) => {
              setBusy("board");
              try {
                await api.post(`/api/leads/${l.id}/board`, { stageId });
                await refresh();
                await globalMutate((k) => typeof k === "string" && k.startsWith("/api/board"));
                toast.success("Lead adicionado ao CRM do Social Seller.");
              } catch (e) {
                toast.error((e as Error).message);
              } finally {
                setBusy(null);
              }
            }}
          />
        )}

        {l.appointment && (
          <Link href={`/agendamentos?reuniao=${l.appointment.id}`} className="mt-4 flex items-center gap-3 rounded-[18px] border border-[#c9ebdc] bg-selected p-4 hover:brightness-[0.99]">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-white text-brand" aria-hidden>
              <CalendarCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-semibold text-brand-dark">{longDayTime(l.appointment.startsAt)}</span>
              <span className="block truncate text-[12.5px] text-brand-dark/80">
                {l.appointment.title} · com {l.appointment.ownerName ?? "—"}
                {l.appointment.status === "canceled" ? " · cancelada" : ""}
              </span>
            </span>
            <ExternalLink className="size-4 text-brand" aria-hidden />
          </Link>
        )}

        {(l.preferredAt || l.preferredText) && l.status !== "scheduled" && (
          <div className="mt-4 flex items-center gap-3 rounded-[18px] border border-line p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-warning-soft text-warning" aria-hidden>
              <CalendarClock className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] text-muted">Melhor horário para o cliente</span>
              <span className="block text-[15px] font-semibold">{l.preferredAt ? longDayTime(l.preferredAt) : l.preferredText}</span>
            </span>
          </div>
        )}

        <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-muted">Origem</h3>
        <div className="mt-2 rounded-[16px] border border-line p-3.5">
          <OriginTrail source={l.source} parts={[l.adChannel, l.partner, l.campaign, l.formName]} at={l.createdAt} />
          {l.adName && <p className="mt-1.5 text-[12.5px] text-muted">Conteúdo / anúncio: {l.adName}</p>}
        </div>

        <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-muted">Formulário / Aplicação{l.formName ? ` · ${l.formName}` : ""}</h3>
        <dl className="mt-1 divide-y divide-line">
          {l.productName && <Row label="Produto de interesse">{l.productName}</Row>}
          {l.customValues.map((c) => (
            <Row key={c.label} label={c.label}>
              {c.value}
            </Row>
          ))}
          <Row label="Nome">{l.name}</Row>
          {l.phone && <Row label="WhatsApp">{formatPhone(l.phone)}</Row>}
          {l.email && <Row label="E-mail">{l.email}</Row>}
          {l.instagram && (
            <Row label="Instagram">
              <a href={`https://www.instagram.com/${l.instagram}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                <InstagramGlyph size={16} /> @{l.instagram}
              </a>
            </Row>
          )}
          {l.answers.map((a, i) => (
            <Row key={i} label={a.label}>
              {a.value}
            </Row>
          ))}
        </dl>

        {utm.length > 0 && (
          <>
            <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-muted">Parâmetros do anúncio (UTM)</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {utm.map(([k, v]) => (
                <span key={k} className="rounded-full bg-page px-3 py-1 text-[12.5px]">
                  <span className="text-muted">{UTM_LABEL[k] ?? k}:</span> {v}
                </span>
              ))}
            </div>
          </>
        )}

        <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-muted">Atendimento</h3>
        <dl className="mt-1 divide-y divide-line">
          <Row label="Responsável (social seller)">
            {me.permissions.assign ? (
              <Select aria-label="Responsável" value={l.assignedTo ?? ""} onChange={(e) => patch({ assignedTo: e.target.value || null }, "Lead repassado.", "assign")} className="mt-1 max-w-[280px]">
                <option value="">Sem responsável</option>
                {team
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            ) : (
              (l.assignedName ?? "—")
            )}
          </Row>
          <Row label="Recebido em">{formatDateTime(l.createdAt)}</Row>
          {l.contactedAt && <Row label="Primeiro contato">{formatDateTime(l.contactedAt)}</Row>}
          {l.previous.length > 0 && <Row label="Já preencheu antes">{l.previous.map((p) => `${formatDateTime(p.createdAt)}${p.formName ? ` · ${p.formName}` : ""}`).join("\n")}</Row>}
        </dl>
        <div className="mt-6">
          <JourneySection contactId={l.contactId} initial={l.journey} />
        </div>
        <div className="mt-6">
          <LeadTasks contact={{ id: l.contactId, name: l.name }} />
        </div>
        <Link href={`?contato=${l.contactId}`} className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand hover:underline">
          <SquareUser className="size-4" aria-hidden /> Abrir ficha completa do contato
        </Link>
      </div>

      <footer className="border-t border-line bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        {open ? (
          <div className="flex flex-col gap-2">
            <Button size="lg" className="w-full" icon={<CalendarCheck className="size-5" />} onClick={() => setScheduling(true)}>
              Confirmar reunião
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="secondary" loading={busy === "contacted"} disabled={l.status === "contacted"} icon={<Check className="size-4" />} onClick={() => patch({ status: "contacted" }, "Marcado como em contato.", "contacted")}>
                Falei
              </Button>
              <Button size="sm" variant="secondary" loading={busy === "no_answer"} disabled={l.status === "no_answer"} icon={<PhoneOff className="size-4" />} onClick={() => patch({ status: "no_answer" }, "Marcado como sem resposta.", "no_answer")}>
                Sem resposta
              </Button>
              <Button size="sm" variant="ghost" loading={busy === "disqualified"} icon={<Ban className="size-4" />} onClick={() => patch({ status: "disqualified" }, "Lead descartado.", "disqualified")}>
                Descartar
              </Button>
            </div>
          </div>
        ) : l.status === "disqualified" ? (
          <Button variant="secondary" className="w-full" loading={busy === "reopen"} onClick={() => patch({ status: "contacted" }, "Lead reaberto.", "reopen")}>
            Reabrir lead
          </Button>
        ) : (
          <div className="flex flex-col gap-2">
            <Button size="lg" className="w-full" icon={<Send className="size-5" />} onClick={() => setForwarding(true)}>
              Encaminhar para Closer
            </Button>
            <Link href={l.appointment ? `/agendamentos?reuniao=${l.appointment.id}` : "/agendamentos"} className="flex h-11 items-center justify-center gap-2 rounded-[14px] border border-[#c9ebdc] bg-selected text-[14px] font-semibold text-brand">
              <CalendarCheck className="size-4" aria-hidden /> Ver em Agendamentos
            </Link>
          </div>
        )}
      </footer>

      <ForwardDialog open={forwarding} onOpenChange={setForwarding} contactId={l.contactId} contactName={l.name} onDone={() => refresh()} />
      <ScheduleDialog
        open={scheduling}
        onOpenChange={setScheduling}
        subtitle={`Com ${l.name}${l.phone ? ` · ${formatPhone(l.phone)}` : ""}`}
        suggested={l.preferredAt}
        defaultTitle={`Reunião com ${l.name}`}
        onSubmit={schedule}
      />
    </div>
  );
}

export function LeadSheet({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!leadId} onOpenChange={(v) => !v && onClose()} title="Lead" width={540}>
      {leadId && <Body id={leadId} onClose={onClose} />}
    </Sheet>
  );
}
