"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarCheck, Check, Copy, NotebookPen, Phone, PhoneCall, PhoneOff, Play, RotateCcw, Send, Square, ThumbsDown } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { fillScript, STATUS_LABEL, type CadenceOutcome } from "@/lib/cadence";
import { formatDateTime } from "@/lib/format";
import type { CadenceStep, ContactCadence } from "@/lib/types";
import { Button, cx, EmptyState, ErrorState, Field, LoadingState, Select, Textarea } from "@/components/ui";
import { WhatsAppButton } from "@/components/ui/WhatsApp";
import { CadenceDueChip, ChannelGlyph, channelLabel, messageFromScript, outcomeLabel, StatusPill, useRefreshCadence, waitLabel } from "./cadenceUi";

type Action = { action: "start" } | { action: "stop" } | { action: "set_step"; stepId: string } | { action: "log"; outcome: CadenceOutcome; note?: string; expectedStepId?: string };

const OUTCOME_ICON: Record<CadenceOutcome, React.ReactNode> = {
  call_answered: <PhoneCall className="size-4 shrink-0" />,
  call_no_answer: <PhoneOff className="size-4 shrink-0" />,
  message_sent: <Send className="size-4 shrink-0" />,
  replied: <Check className="size-4 shrink-0" />,
  scheduled: <CalendarCheck className="size-4 shrink-0" />,
  not_interested: <ThumbsDown className="size-4 shrink-0" />,
  note: <NotebookPen className="size-4 shrink-0" />,
};

/** Aba "Cadência" do painel do contato: passo atual, roteiro, registro de resultado e histórico. */
export function CadencePanel({ contactId, contactName, phone, onChanged }: { contactId: string; contactName: string; phone: string | null; onChanged?: () => void }) {
  const key = `/api/contacts/${contactId}/cadence`;
  const { data, error, isLoading, mutate } = useSWR<ContactCadence>(key, fetcher);
  const me = useMe();
  const refresh = useRefreshCadence();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const run = async (body: Action, id: string, success?: string) => {
    setBusy(id);
    try {
      const next = await api.post<ContactCadence>(key, body);
      mutate(next, { revalidate: false });
      if (body.action === "log") setNote("");
      if (success) toast.success(success);
      refresh();
      onChanged?.();
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        toast.warning(err.message);
        mutate();
      } else toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (isLoading || !data) return <LoadingState rows={4} />;
  if (!data.entry) return <EmptyState icon={<PhoneCall />} title="Fora do quadro" description="Coloque o contato numa etapa do Kanban do Social Seller para usar a cadência." />;

  const { entry, steps, currentStep, activities } = data;
  const status = entry.status;
  const fill = (s: CadenceStep) => fillScript(s.script, { nome: contactName, responsavel: me.user.name });
  const stepIndex = currentStep ? steps.findIndex((s) => s.id === currentStep.id) : -1;
  const disabled = busy !== null;

  const noteBox = (
    <Field label="Anotação (opcional)" htmlFor="cad-note" hint="Vai junto com o resultado que você clicar. Ex.: pediu para ligar depois das 18h.">
      <Textarea id="cad-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className="min-h-[72px]" placeholder="O que aconteceu?" />
    </Field>
  );
  const onlyNote = (
    <Button variant="secondary" size="sm" icon={<NotebookPen className="size-4" />} loading={busy === "note"} disabled={disabled || !note.trim()} onClick={() => run({ action: "log", outcome: "note", note: note.trim() }, "note", "Anotação salva.")}>
      Só anotar
    </Button>
  );

  return (
    <div className="flex flex-col gap-5">
      {status === null && (
        <section className="flex flex-col gap-4">
          <div className="rounded-[18px] border border-[#c9ebdc] bg-selected/60 p-4">
            <p className="text-[15px] font-semibold text-brand-dark">Cadência não iniciada</p>
            <p className="mt-1 text-[13.5px] text-[#2d4a40]">
              A cadência organiza os contatos com este lead: cada passo mostra o que fazer, o que falar e quando. Você registra o resultado com um clique e o próximo passo já fica agendado.
            </p>
          </div>
          {steps.length === 0 ? (
            <p className="text-[13.5px] text-muted">Nenhum passo configurado. Um gestor pode criar os passos em Social Seller → Cadência → Editar cadência.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {steps.map((s, i) => (
                <li key={s.id} className="flex items-center gap-3 rounded-[14px] border border-line px-3 py-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-page text-[12.5px] font-semibold">{i + 1}</span>
                  <ChannelGlyph channel={s.channel} className="size-4 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{s.name}</span>
                  <span className="shrink-0 text-[12.5px] text-muted">{i === 0 ? "ao iniciar" : waitLabel(s.waitDays)}</span>
                </li>
              ))}
            </ol>
          )}
          <Button className="self-start max-sm:w-full" icon={<Play className="size-4" />} disabled={!steps.length || disabled} loading={busy === "start"} onClick={() => run({ action: "start" }, "start", "Cadência iniciada.")}>
            Iniciar cadência
          </Button>
        </section>
      )}

      {status === "active" && currentStep && (
        <section className="flex flex-col gap-4 rounded-[20px] border border-line p-4 shadow-[0_1px_2px_rgb(16_60_48/0.05)]">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[12.5px] font-medium text-muted">
                Etapa {stepIndex >= 0 ? stepIndex + 1 : "—"} de {steps.length}
                {currentStep.archivedAt ? " · passo removido da cadência" : ""}
              </p>
              <h3 className="mt-0.5 flex items-center gap-2 text-[18px] font-semibold">
                <ChannelGlyph channel={currentStep.channel} className="size-5 text-brand" />
                {currentStep.name}
              </h3>
              <p className="text-[13px] text-muted">{channelLabel(currentStep.channel)}</p>
            </div>
            <CadenceDueChip at={entry.dueAt} />
          </div>

          <ScriptBox text={fill(currentStep)} />

          <div className="grid grid-cols-2 gap-2">
            <a
              href={phone ? `tel:${phone}` : undefined}
              aria-disabled={!phone}
              className={cx("inline-flex h-11 items-center justify-center gap-2 rounded-[12px] border border-line bg-white text-[14px] font-semibold hover:bg-page", !phone && "pointer-events-none opacity-50")}
            >
              <Phone className="size-[18px]" aria-hidden /> Ligar
            </a>
            {phone ? (
              <WhatsAppButton phone={phone} name={contactName} text={currentStep.channel === "whatsapp" ? messageFromScript(fill(currentStep)) : undefined} className="h-11" />
            ) : (
              <span className="inline-flex h-11 items-center justify-center rounded-[12px] border border-dashed border-line text-[13px] text-muted">Sem telefone</span>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[14px] font-semibold">Como foi?</p>
            <div className="grid grid-cols-2 gap-2">
              {(currentStep.channel === "call" ? (["call_answered", "call_no_answer"] as const) : (["message_sent", "replied"] as const)).map((o) => (
                <OutcomeButton key={o} outcome={o} busy={busy} disabled={disabled} primary onClick={() => run({ action: "log", outcome: o, note: note.trim() || undefined, expectedStepId: entry.stepId ?? undefined }, o, `${outcomeLabel(o)} registrado.`)} />
              ))}
              {(["scheduled", "not_interested"] as const).map((o) => (
                <OutcomeButton key={o} outcome={o} busy={busy} disabled={disabled} onClick={() => run({ action: "log", outcome: o, note: note.trim() || undefined, expectedStepId: entry.stepId ?? undefined }, o, `${outcomeLabel(o)} registrado.`)} />
              ))}
            </div>
          </div>

          {noteBox}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {onlyNote}
            <StepJump steps={steps} currentId={currentStep.id} disabled={disabled} label="Pular para etapa…" onPick={(id) => run({ action: "set_step", stepId: id }, "set_step", "Etapa alterada.")} />
            <Button variant="ghost" size="sm" className="ml-auto text-danger" icon={<Square className="size-4" />} loading={busy === "stop"} disabled={disabled} onClick={() => confirm("Parar a cadência deste lead?") && run({ action: "stop" }, "stop", "Cadência parada.")}>
              Parar cadência
            </Button>
          </div>
        </section>
      )}

      {status !== null && (status !== "active" || !currentStep) && (
        <section className="flex flex-col gap-3 rounded-[20px] border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={status} />
            {currentStep && <span className="text-[13px] text-muted">Último passo: {currentStep.name}</span>}
          </div>
          <p className="text-[13.5px] text-muted">
            {status === "responded"
              ? "O lead está em conversa. A cadência fica pausada até você recomeçar ou continuar de um passo."
              : status === "scheduled"
                ? "Reunião agendada. A cadência foi pausada."
                : status === "lost"
                  ? "Marcado como sem interesse. Se ele voltar a falar, recomece a cadência."
                  : status === "finished"
                    ? "Todos os passos foram feitos. Se fizer sentido, recomece mais pra frente."
                    : STATUS_LABEL[status]}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<RotateCcw className="size-4" />} loading={busy === "start"} disabled={disabled} onClick={() => run({ action: "start" }, "start", "Cadência recomeçada.")}>
              Recomeçar cadência
            </Button>
            <StepJump steps={steps} currentId={null} disabled={disabled} label="Continuar da etapa…" onPick={(id) => run({ action: "set_step", stepId: id }, "set_step", "Cadência retomada.")} />
          </div>
          {noteBox}
          <div>{onlyNote}</div>
        </section>
      )}

      {status === null && steps.length > 0 && (
        <details className="rounded-[16px] border border-line px-4 py-3 text-[13.5px]">
          <summary className="cursor-pointer font-medium">Fazer só uma anotação</summary>
          <div className="mt-3 flex flex-col gap-2">
            {noteBox}
            <div>{onlyNote}</div>
          </div>
        </details>
      )}

      <section>
        <h3 className="mb-3 text-[15px] font-semibold">Histórico da cadência</h3>
        {activities.length === 0 ? (
          <p className="py-4 text-center text-[13.5px] text-muted">Nada registrado ainda.</p>
        ) : (
          <ol className="relative ml-2 flex flex-col gap-4 border-l-2 border-line pl-5">
            {activities.map((a) => (
              <li key={a.id} className="relative">
                <span className={cx("absolute -left-[27px] top-1 size-3 rounded-full ring-4 ring-white", a.outcome === "not_interested" || a.outcome === "stopped" ? "bg-[#94a3ad]" : "bg-brand")} aria-hidden />
                <p className="text-[14px]">
                  <span className="font-medium">{outcomeLabel(a.outcome)}</span>
                  {a.stepName && <span className="text-muted"> · {a.stepName}</span>}
                </p>
                {a.note && <p className="mt-0.5 whitespace-pre-wrap break-words text-[13.5px] text-[#3d4d56]">{a.note}</p>}
                <p className="text-[12px] text-muted">
                  {a.actorName ?? "Automático"} · {formatDateTime(a.createdAt)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function OutcomeButton({ outcome, busy, disabled, primary, onClick }: { outcome: CadenceOutcome; busy: string | null; disabled: boolean; primary?: boolean; onClick: () => void }) {
  return (
    <Button variant={primary ? "soft" : "secondary"} className="h-12 w-full gap-1.5 px-2 text-[13.5px] leading-tight sm:text-[14px]" icon={OUTCOME_ICON[outcome]} loading={busy === outcome} disabled={disabled} onClick={onClick}>
      <span className="min-w-0 whitespace-normal text-center">{outcomeLabel(outcome)}</span>
    </Button>
  );
}

function StepJump({ steps, currentId, disabled, label, onPick }: { steps: CadenceStep[]; currentId: string | null; disabled: boolean; label: string; onPick: (id: string) => void }) {
  if (steps.length < 2 && currentId) return null;
  return (
    <Select aria-label={label} value="" disabled={disabled} onChange={(e) => e.target.value && onPick(e.target.value)} className="h-9 w-auto max-w-[200px] rounded-[12px] text-[13px]">
      <option value="">{label}</option>
      {steps.map((s, i) => (
        <option key={s.id} value={s.id} disabled={s.id === currentId}>
          {i + 1}. {s.name}
        </option>
      ))}
    </Select>
  );
}

function ScriptBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    }
  };
  return (
    <div className="rounded-[16px] border border-[#f3e7b8] bg-[#fffbea] p-3.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-[#6b4a00]">O que fazer agora</p>
        <button type="button" onClick={copy} className="inline-flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[12.5px] font-medium text-[#6b4a00] hover:bg-[#f8eec8]" aria-label="Copiar roteiro">
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      {text.trim() ? <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[#3b3220]">{text}</p> : <p className="text-[13.5px] text-muted">Este passo não tem roteiro.</p>}
    </div>
  );
}
