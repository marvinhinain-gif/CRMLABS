"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Send, UserRoundCheck } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Avatar, Button, cx, Dialog, Field, Textarea } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";

export type ForwardState = {
  current: { id: string; status: "open" | "won" | "lost"; closerId: string | null; closerName: string | null; forwardedAt: string; stageName: string | null } | null;
  closers: { id: string; name: string }[];
};

/** Social seller encaminha o lead qualificado para um closer (entra no Kanban dele, com todo o histórico). */
export function ForwardDialog({ open, onOpenChange, contactId, contactName, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; contactId: string; contactName: string; onDone?: () => void }) {
  const key = `/api/contacts/${contactId}/forward`;
  const { data } = useSWR<ForwardState>(open ? key : null, fetcher);
  const { mutate } = useSWRConfig();
  const [closerId, setCloserId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCloserId("");
      setNote("");
    }
  }, [open]);
  const current = data?.current?.status === "open" ? data.current : null;
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ closerName: string | null }>(key, { closerId, note: note.trim() || null });
      toast.success(`${contactName} → Closer: ${r.closerName ?? "closer"}. O lead já está no Comercial dele.`);
      mutate((k) => typeof k === "string" && (k.startsWith("/api/contacts") || k.startsWith("/api/opportunities") || k.startsWith("/api/board") || k.startsWith("/api/commercial") || k.startsWith("/api/leads")));
      onDone?.();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Encaminhar Lead"
      description="O lead entra no Kanban do closer na etapa de entrada, com respostas, origem, anotações e histórico."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button icon={<Send className="size-4" />} onClick={submit} loading={busy} disabled={!closerId || closerId === current?.closerId}>
            Confirmar encaminhamento
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[12.5px] font-medium text-muted">Lead</p>
          <div className="mt-1 flex items-center gap-2.5">
            <Avatar name={contactName} size={34} />
            <p className="text-[16px] font-semibold">{contactName}</p>
          </div>
        </div>
        {current && (
          <p className="flex items-start gap-2 rounded-[14px] bg-info-soft px-3.5 py-2.5 text-[13px] text-info">
            <UserRoundCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Já encaminhado para <b>{current.closerName ?? "closer"}</b> em {formatDateTime(current.forwardedAt)}
              {current.stageName ? ` · etapa ${current.stageName}` : ""}. Escolher outro closer transfere o lead.
            </span>
          </p>
        )}
        <fieldset>
          <legend className="text-[14px] font-medium">Selecionar Closer</legend>
          {!data ? (
            <div className="skeleton mt-2 h-24" />
          ) : data.closers.length === 0 ? (
            <p className="mt-2 rounded-[14px] bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">Nenhum closer ativo na equipe. Peça ao administrador para convidar um closer.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2" role="radiogroup">
              {data.closers.map((c) => {
                const on = closerId === c.id;
                const isCurrent = current?.closerId === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={isCurrent}
                    onClick={() => setCloserId(c.id)}
                    className={cx("flex items-center gap-3 rounded-[14px] border px-3.5 py-2.5 text-left transition-colors", on ? "border-brand bg-selected" : "border-line hover:bg-page", isCurrent && "opacity-60")}
                  >
                    <span className={cx("flex size-5 items-center justify-center rounded-full border-2", on ? "border-brand" : "border-[#b7c6c1]")} aria-hidden>
                      {on && <span className="size-2.5 rounded-full bg-brand" />}
                    </span>
                    <TeamAvatar userId={c.id} name={c.name} size={30} />
                    <span className="flex-1 text-[14.5px] font-medium">{c.name}</span>
                    {isCurrent && <span className="text-[12px] text-muted">atual</span>}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
        <Field label="Observação para o closer (opcional)" htmlFor="fw-note">
          <Textarea id="fw-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: fatura R$ 40 mil/mês, quer escalar o time comercial." />
        </Field>
      </div>
    </Dialog>
  );
}
