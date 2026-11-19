"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { PhoneCall } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import type { ForwardToKanbanResult, SdrBoard } from "@/lib/types";
import { Avatar, Button, cx, Dialog, ErrorState } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";

/** Gestor encaminha o lead da comunidade para o Kanban de um SDR; a cadência começa em "Ligação 1", para hoje. */
export function SdrForwardDialog({
  open,
  onOpenChange,
  leadId,
  contactName,
  currentSdrId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  contactName: string;
  currentSdrId?: string | null;
  onDone?: () => void;
}) {
  const { data: sdrs, error, mutate: reload } = useSWR<SdrBoard[]>(open ? "/api/board/sdrs" : null, fetcher);
  const { mutate } = useSWRConfig();
  const [sdrId, setSdrId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setSdrId("");
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<ForwardToKanbanResult>(`/api/leads/${leadId}/kanban`, { sdrId });
      toast.success(`${contactName} encaminhado para ${r.sdrName} · já na fase de Ligação`);
      await mutate((k) => typeof k === "string" && (k.startsWith("/api/community") || k.startsWith("/api/leads") || k.startsWith("/api/board") || k.startsWith("/api/contacts")));
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
      onOpenChange={(v) => !busy && onOpenChange(v)}
      size="sm"
      title="Encaminhar para SDR"
      description="O lead entra no Kanban do SDR, já na fase de Ligação da cadência (Ligação 1, para hoje)."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button icon={<PhoneCall className="size-4" />} onClick={submit} loading={busy} disabled={!sdrId || sdrId === currentSdrId}>
            Encaminhar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[12.5px] font-medium text-muted">Lead</p>
          <div className="mt-1 flex items-center gap-2.5">
            <Avatar name={contactName} size={34} />
            <p className="min-w-0 truncate text-[16px] font-semibold">{contactName}</p>
          </div>
        </div>
        <fieldset>
          <legend className="text-[14px] font-medium">Selecionar SDR</legend>
          {error && !sdrs ? (
            <ErrorState error={error} onRetry={() => reload()} className="mt-2" />
          ) : !sdrs ? (
            <div className="skeleton mt-2 h-24" aria-busy="true" aria-label="Carregando SDRs" />
          ) : sdrs.length === 0 ? (
            <p className="mt-2 rounded-[14px] bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">Nenhum SDR ativo na equipe. Peça ao administrador para convidar um SDR.</p>
          ) : (
            <div className="mt-2 flex max-h-[50vh] flex-col gap-2 overflow-y-auto scroll-thin" role="radiogroup" aria-label="SDR">
              {sdrs.map((s) => {
                const on = sdrId === s.userId;
                const isCurrent = currentSdrId === s.userId;
                return (
                  <button
                    key={s.userId}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={isCurrent}
                    onClick={() => setSdrId(s.userId)}
                    className={cx("flex min-h-12 items-center gap-3 rounded-[14px] border px-3.5 py-2.5 text-left transition-colors", on ? "border-brand bg-selected" : "border-line hover:bg-page", isCurrent && "opacity-60")}
                  >
                    <span className={cx("flex size-5 shrink-0 items-center justify-center rounded-full border-2", on ? "border-brand" : "border-[#b7c6c1]")} aria-hidden>
                      {on && <span className="size-2.5 rounded-full bg-brand" />}
                    </span>
                    <TeamAvatar userId={s.userId} name={s.name} size={30} />
                    <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{s.name}</span>
                    {isCurrent ? <span className="shrink-0 text-[12px] text-muted">atual</span> : <span className="shrink-0 text-[12px] text-muted">{s.total} no Kanban</span>}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>
      </div>
    </Dialog>
  );
}
