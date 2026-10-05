"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { CalendarCheck, CalendarPlus, CircleX, History, Mail, MessageCircle, Phone, RotateCcw, Send, Trophy, X } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact } from "@/lib/nav";
import { formatBRL, formatDateTime, formatPhone, longDayTime, parseBRLToCents, relativeTime, whatsappLink } from "@/lib/format";
import { STAGE_TYPE_LABEL } from "@/lib/stageTypes";
import { Avatar, Button, cx, Dialog, ErrorState, Field, Input, LoadingState, Select, Sheet, SheetClose, Textarea } from "@/components/ui";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";
import { ScheduleDialog, type ScheduleValues } from "@/components/agenda/ScheduleDialog";
import { JourneySection, type Journey } from "@/components/integrations/Journey";
import { LeadTasks } from "@/components/tasks/TaskParts";

export type OppDetail = {
  id: string;
  title: string;
  product: string | null;
  valueCents: number;
  status: "open" | "won" | "lost";
  version: number;
  closedAt: string | null;
  lostReason: string | null;
  forwardedAt: string | null;
  createdAt: string;
  closerId: string | null;
  closerName: string | null;
  sellerName: string | null;
  stage: { id: string; name: string; color: string; stageType: string } | null;
  stages: { id: string; name: string; color: string; stageType: string }[];
  contact: { id: string; name: string; phone: string | null; email: string | null; username: string | null; avatarUrl: string | null; summary: string | null; ownerName: string | null } | null;
  lead: { id: string; answers: { label: string; value: string }[]; formName: string | null; campaign: string | null; createdAt: string; preferredAt: string | null; preferredText: string | null } | null;
  history: { id: string; at: string; from: string | null; to: string | null; reason: string | null; actorName: string | null }[];
  notes: { id: string; body: string; createdAt: string; authorName: string | null }[];
  meetings: { id: string; title: string; startsAt: string; status: string; location: string | null }[];
  journey: Journey;
};

export const refreshCommercial = (mutate: ReturnType<typeof useSWRConfig>["mutate"]) =>
  mutate((k) => typeof k === "string" && (k.startsWith("/api/commercial") || k.startsWith("/api/opportunities") || k.startsWith("/api/dashboard") || k.startsWith("/api/agenda") || k.startsWith("/api/appointments") || k.startsWith("/api/contacts/")));

/** Ganhou (pede o valor) ou perdeu (pede o motivo). Usado no Kanban e na ficha do lead. */
export function CloseDealDialog({ mode, title, valueCents, onConfirm, onClose }: { mode: "won" | "lost" | null; title: string; valueCents: number; onConfirm: (v: { valueCents?: number; lostReason?: string }) => Promise<void>; onClose: () => void }) {
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!mode) return null;
  const submit = async () => {
    setErr(undefined);
    let cents: number | undefined;
    if (mode === "won") {
      const parsed = value ? parseBRLToCents(value) : valueCents;
      if (!parsed) return setErr("Informe o valor da venda.");
      cents = parsed;
    } else if (reason.trim().length < 3) return setErr("Informe o motivo da perda.");
    setBusy(true);
    try {
      await onConfirm(mode === "won" ? { valueCents: cents } : { lostReason: reason.trim() });
      setValue("");
      setReason("");
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      size="sm"
      title={mode === "won" ? "🎉 Venda ganha" : "Venda perdida"}
      description={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={mode === "won" ? "primary" : "danger"} onClick={submit} loading={busy}>
            {mode === "won" ? "Registrar venda" : "Registrar perda"}
          </Button>
        </>
      }
    >
      {mode === "won" ? (
        <Field label="Valor da venda (R$)" htmlFor="cd-val" error={err} hint={valueCents ? `Valor atual: ${formatBRL(valueCents)}` : "Entra no faturamento, na meta e no ranking."}>
          <Input id="cd-val" autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={valueCents ? (valueCents / 100).toFixed(2).replace(".", ",") : "15.000,00"} />
        </Field>
      ) : (
        <Field label="Motivo da perda" htmlFor="cd-reason" error={err}>
          <Textarea id="cd-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: sem orçamento no momento" />
        </Field>
      )}
    </Dialog>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{title}</h3>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words text-[14.5px]">{children}</dd>
    </div>
  );
}

function Body({ o, onClose }: { o: OppDetail; onClose: () => void }) {
  const me = useMe();
  const { mutate } = useSWRConfig();
  const openContact = useOpenContact();
  const [closing, setClosing] = useState<"won" | "lost" | null>(null);
  const [schedule, setSchedule] = useState(false);
  const [note, setNote] = useState("");
  const [value, setValue] = useState("");
  const c = o.contact;
  const refresh = () => refreshCommercial(mutate);
  const decider = me.permissions.decide;

  const move = async (stageId: string) => {
    const to = o.stages.find((s) => s.id === stageId);
    if (to?.stageType === "won" || to?.stageType === "lost") return setClosing(to.stageType);
    try {
      await api.patch(`/api/opportunities/${o.id}`, { stageId, expectedVersion: o.version });
      toast.success(`Movido para ${to?.name}.`);
      refresh();
      if (to?.stageType === "scheduled" && !o.meetings.some((m) => m.status === "scheduled" && new Date(m.startsAt).getTime() > Date.now())) setSchedule(true);
    } catch (e) {
      toast.error((e as Error).message);
      refresh();
    }
  };
  const close = async (v: { valueCents?: number; lostReason?: string }) => {
    if (closing === "won") await api.post(`/api/opportunities/${o.id}/decide`, { status: "won", valueCents: v.valueCents });
    else await api.post(`/api/opportunities/${o.id}/decide`, { status: "lost", lostReason: v.lostReason });
    toast.success(closing === "won" ? "Venda registrada! O Dashboard já foi atualizado." : "Perda registrada.");
    refresh();
  };
  const reopen = async () => {
    try {
      await api.post(`/api/opportunities/${o.id}/decide`, { status: "open" });
      toast.success("Reaberta. As métricas foram recalculadas.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const saveValue = async () => {
    const cents = parseBRLToCents(value);
    if (cents === null || cents === o.valueCents) return setValue("");
    try {
      await api.patch(`/api/opportunities/${o.id}`, { valueCents: cents });
      setValue("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const addNote = async () => {
    if (!c || !note.trim()) return;
    try {
      await api.post(`/api/contacts/${c.id}/notes`, { body: note.trim() });
      setNote("");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const book = async (v: ScheduleValues) => {
    if (!c) return;
    await api.post("/api/appointments", { ...v, contactId: c.id, opportunityId: o.id, timezone: me.org.timezone });
    toast.success("Reunião marcada.");
    refresh();
  };

  const first = c?.name.split(" ")[0] ?? "";
  const wa = whatsappLink(c?.phone, `Olá, ${first}! Aqui é ${me.user.name.split(" ")[0]}, da ${me.org.name}.`);
  const next = o.meetings.find((m) => m.status === "scheduled" && new Date(m.startsAt).getTime() > Date.now() - 2 * 3600_000);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-5 sm:px-6">
        <Avatar name={c?.name} src={c?.avatarUrl} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] font-semibold leading-tight">{c?.name ?? o.title}</h2>
          {(o.product || c?.username) && <p className="truncate text-[13px] text-muted">{o.product ?? `@${c?.username}`}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {o.status === "open" && decider ? (
              <Select aria-label="Etapa" value={o.stage?.id ?? ""} onChange={(e) => move(e.target.value)} className="!h-9 w-auto min-w-[150px] rounded-full !py-0 pl-3.5 text-[13px] font-semibold" style={{ backgroundColor: `var(--stage-${o.stage?.color ?? "gray"}-chip)` }}>
                {o.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            ) : (
              <span className={cx("rounded-full px-3 py-1 text-[12.5px] font-semibold", o.status === "won" ? "bg-success-soft text-success" : o.status === "lost" ? "bg-danger-soft text-danger" : "bg-page")}>
                {o.status === "won" ? `Venda ganha · ${formatBRL(o.valueCents)}` : o.status === "lost" ? "Perdida" : o.stage?.name}
              </span>
            )}
          </div>
        </div>
        <SheetClose asChild>
          <button className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page" aria-label="Fechar" onClick={onClose}>
            <X className="size-5" />
          </button>
        </SheetClose>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin px-5 py-4 sm:px-6">
        <div className="grid grid-cols-4 gap-2">
          <a href={wa ?? undefined} target="_blank" rel="noreferrer" aria-disabled={!wa} className={cx("flex flex-col items-center gap-1 rounded-[16px] border px-1 py-3 text-[12.5px] font-medium", wa ? "border-[#bfe8d3] bg-[#e9f9f1] text-[#0f7a4f]" : "pointer-events-none border-line text-muted opacity-50")}>
            <MessageCircle className="size-5" aria-hidden /> WhatsApp
          </a>
          <a href={c?.phone ? `tel:${c.phone}` : undefined} aria-disabled={!c?.phone} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line px-1 py-3 text-[12.5px] font-medium hover:bg-page", !c?.phone && "pointer-events-none opacity-50")}>
            <Phone className="size-5" aria-hidden /> Ligar
          </a>
          <a href={c?.username ? `https://www.instagram.com/${c.username}/` : undefined} target="_blank" rel="noreferrer" aria-disabled={!c?.username} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line px-1 py-3 text-[12.5px] font-medium hover:bg-page", !c?.username && "pointer-events-none opacity-50")}>
            <InstagramGlyph size={20} /> Instagram
          </a>
          <a href={c?.email ? `mailto:${c.email}` : undefined} aria-disabled={!c?.email} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line px-1 py-3 text-[12.5px] font-medium hover:bg-page", !c?.email && "pointer-events-none opacity-50")}>
            <Mail className="size-5" aria-hidden /> E-mail
          </a>
        </div>

        {o.forwardedAt && o.sellerName && (
          <p className="mt-4 flex items-start gap-2 rounded-[16px] bg-selected px-4 py-3 text-[13.5px] text-brand-dark">
            <Send className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Qualificado por <b>{o.sellerName}</b> e encaminhado {o.closerName ? <>para <b>{o.closerName}</b> </> : ""}em {formatDateTime(o.forwardedAt)}.
            </span>
          </p>
        )}

        {next ? (
          <Link href={`/agendamentos?reuniao=${next.id}`} className="mt-3 flex items-center gap-3 rounded-[18px] border border-[#c9ebdc] bg-white p-4 hover:bg-selected/40">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-selected text-brand" aria-hidden>
              <CalendarCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-semibold">{longDayTime(next.startsAt)}</span>
              <span className="block truncate text-[12.5px] text-muted">
                {next.title}
                {next.location ? ` · ${next.location}` : ""}
              </span>
            </span>
          </Link>
        ) : (
          o.status === "open" && (
            <Button variant="secondary" className="mt-3 w-full" icon={<CalendarPlus className="size-4" />} onClick={() => setSchedule(true)}>
              Agendar reunião
            </Button>
          )
        )}

        <Section title="Dados">
          <dl className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
            <Row label="Telefone / WhatsApp">{c?.phone ? formatPhone(c.phone) : "—"}</Row>
            <Row label="E-mail">{c?.email ?? "—"}</Row>
            <Row label="Instagram">{c?.username ? `@${c.username}` : "—"}</Row>
            <Row label="Produto de interesse">{o.product ?? "—"}</Row>
            <Row label="Valor">
              {decider && o.status === "open" ? (
                <Input aria-label="Valor da oportunidade" inputMode="decimal" className="mt-1 h-9 max-w-[180px]" value={value} placeholder={o.valueCents ? formatBRL(o.valueCents) : "R$ 0,00"} onChange={(e) => setValue(e.target.value)} onBlur={saveValue} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
              ) : (
                formatBRL(o.valueCents)
              )}
            </Row>
            <Row label="Closer">{o.closerName ?? "—"}</Row>
          </dl>
          {c && (
            <button onClick={() => openContact(c.id)} className="mt-1 text-[13px] font-medium text-brand hover:underline">
              Abrir contato completo
            </button>
          )}
        </Section>

        {c && (
          <Section title="Origem e qualificação">
            <JourneySection contactId={c.id} initial={o.journey} closerView compact />
          </Section>
        )}

        {o.lead && o.lead.answers.length > 0 && (
          <Section title={`Formulário / Aplicação${o.lead.formName ? ` · ${o.lead.formName}` : ""}`}>
            <dl className="divide-y divide-line">
              {o.lead.campaign && <Row label="Campanha">{o.lead.campaign}</Row>}
              {o.lead.answers.map((a, i) => (
                <Row key={i} label={a.label}>
                  {a.value}
                </Row>
              ))}
            </dl>
          </Section>
        )}

        <Section title={`Anotações${o.notes.length ? ` · ${o.notes.length}` : ""}`}>
          <div className="flex gap-2">
            <Input aria-label="Nova anotação" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addNote()} placeholder="Escreva uma anotação" />
            <Button variant="secondary" onClick={addNote} disabled={!note.trim()}>
              Salvar
            </Button>
          </div>
          <ul className="mt-2 flex flex-col gap-2">
            {o.notes.map((n) => (
              <li key={n.id} className="rounded-[14px] bg-page/70 px-3.5 py-2.5">
                <p className="whitespace-pre-wrap text-[14px]">{n.body}</p>
                <p className="mt-1 text-[12px] text-muted">
                  {n.authorName ?? "—"} · {relativeTime(n.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        </Section>

        {c && (
          <div className="mt-6">
            <LeadTasks contact={{ id: c.id, name: c.name }} opportunityId={o.id} defaultOwnerId={o.closerId} />
          </div>
        )}

        <Section title="Histórico">
          <ol className="relative ml-2 border-l-2 border-line">
            {o.history.map((h) => (
              <li key={h.id} className="relative pb-4 pl-5 last:pb-0">
                <span className="absolute -left-[7px] top-1 size-3 rounded-full border-2 border-white bg-brand" aria-hidden />
                <p className="text-[12.5px] font-medium text-muted">{formatDateTime(h.at).replace(" ", " — ").replace(",", "")}</p>
                {h.reason?.startsWith("Lead qualificado") ? (
                  <p className="text-[14px]">{h.reason.replace(" · ", " — ")}</p>
                ) : h.from && h.to && h.from !== h.to ? (
                  <p className="text-[14px]">
                    Lead movido: <b className="font-medium">{h.from}</b> → <b className="font-medium">{h.to}</b>
                  </p>
                ) : (
                  <p className="text-[14px]">{h.reason ?? (h.to ? `Entrou em ${h.to}` : "Atualizado")}</p>
                )}
                {(h.actorName || (h.reason && h.from && h.to && h.from !== h.to)) && (
                  <p className="text-[12px] text-muted">
                    {h.actorName ? `por ${h.actorName}` : ""}
                    {h.reason && h.from && h.to && h.from !== h.to ? `${h.actorName ? " · " : ""}${h.reason}` : ""}
                  </p>
                )}
              </li>
            ))}
            {o.history.length === 0 && (
              <li className="pl-5 text-[13.5px] text-muted">
                <History className="mr-1 inline size-4" aria-hidden /> Sem movimentações.
              </li>
            )}
          </ol>
        </Section>
      </div>

      {decider && (
        <footer className="flex gap-2 border-t border-line px-5 py-3 sm:px-6">
          {o.status === "open" ? (
            <>
              <Button className="flex-1" icon={<Trophy className="size-4" />} onClick={() => setClosing("won")}>
                Venda ganha
              </Button>
              <Button variant="secondary" icon={<CircleX className="size-4" />} onClick={() => setClosing("lost")}>
                Perdida
              </Button>
            </>
          ) : (
            <Button variant="secondary" className="flex-1" icon={<RotateCcw className="size-4" />} onClick={reopen}>
              Reabrir {o.status === "won" ? "venda" : "oportunidade"}
            </Button>
          )}
        </footer>
      )}
      <CloseDealDialog mode={closing} title={c?.name ?? o.title} valueCents={o.valueCents} onConfirm={close} onClose={() => setClosing(null)} />
      <ScheduleDialog open={schedule} onOpenChange={setSchedule} title="Agendar reunião" subtitle={c?.name} defaultTitle={`Reunião com ${first}`} defaultOwnerId={o.closerId} submitLabel="Agendar" onSubmit={book} />
    </div>
  );
}

/** Lead dentro do Comercial: tudo o que veio do social seller e do formulário, tarefas e histórico. */
export function OpportunitySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, error } = useSWR<OppDetail>(id ? `/api/opportunities/${id}` : null, fetcher);
  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()} title={data?.contact?.name ?? "Lead"} width={600}>
      {error ? (
        <div className="p-6">
          <ErrorState error={error as ApiError} />
        </div>
      ) : !data ? (
        <div className="p-6">
          <LoadingState rows={6} />
        </div>
      ) : (
        <Body o={data} onClose={onClose} />
      )}
    </Sheet>
  );
}

export { STAGE_TYPE_LABEL };
