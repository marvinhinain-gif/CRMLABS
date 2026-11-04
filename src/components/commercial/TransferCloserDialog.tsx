"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { Avatar, Button, cx, Dialog, Field, Textarea } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import type { ForwardState } from "./ForwardDialog";

/** Gestor/administrador passa o lead que já está no Comercial de um closer para outro (mesma etapa, com histórico). */
export function TransferCloserDialog({
  open,
  onOpenChange,
  opportunity,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  opportunity: { id: string; version: number; closerId: string | null; closerName: string | null; stageName: string | null; contactId: string; contactName: string };
  onDone?: () => void;
}) {
  const o = opportunity;
  const { data } = useSWR<ForwardState>(open ? `/api/contacts/${o.contactId}/forward` : null, fetcher);
  const [closerId, setCloserId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setCloserId("");
      setNote("");
    }
  }, [open]);
  const chosen = data?.closers.find((c) => c.id === closerId);
  const submit = async () => {
    if (!closerId) return;
    setBusy(true);
    try {
      await api.patch(`/api/opportunities/${o.id}`, { closerId, expectedVersion: o.version });
      if (note.trim()) {
        await api.post(`/api/contacts/${o.contactId}/notes`, { body: `Transferido para ${chosen?.name ?? "outro closer"}: ${note.trim()}` }).catch(() => toast.error("Lead transferido, mas a observação não foi salva."));
      }
      toast.success(`${o.contactName} → Closer: ${chosen?.name ?? "closer"}. O lead já está no Comercial dele.`);
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
      title="Transferir para outro closer"
      description="O lead sai do Kanban do closer atual e entra no do closer escolhido, na mesma etapa, com respostas, anotações, tarefas e histórico."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button icon={<ArrowRightLeft className="size-4" />} onClick={submit} loading={busy} disabled={!closerId || closerId === o.closerId}>
            Transferir
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[12.5px] font-medium text-muted">Lead</p>
          <div className="mt-1 flex items-center gap-2.5">
            <Avatar name={o.contactName} size={34} />
            <div className="min-w-0">
              <p className="truncate text-[16px] font-semibold">{o.contactName}</p>
              <p className="truncate text-[12.5px] text-muted">
                Hoje com <b className="text-ink">{o.closerName ?? "ninguém"}</b>
                {o.stageName ? ` · etapa ${o.stageName}` : ""}
              </p>
            </div>
          </div>
        </div>
        <fieldset>
          <legend className="text-[14px] font-medium">Escolher o novo closer</legend>
          {!data ? (
            <div className="skeleton mt-2 h-24" />
          ) : data.closers.length === 0 ? (
            <p className="mt-2 rounded-[14px] bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">Nenhum closer ativo na equipe. Em Configurações → Equipe, convide um closer ou marque “Também é closer”.</p>
          ) : (
            <div className="mt-2 flex flex-col gap-2" role="radiogroup">
              {data.closers.map((c) => {
                const on = closerId === c.id;
                const isCurrent = o.closerId === c.id;
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
        <Field label="Observação para o novo closer (opcional)" htmlFor="tr-note">
          <Textarea id="tr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex.: o closer anterior está de férias; reunião combinada para quinta." />
        </Field>
      </div>
    </Dialog>
  );
}
