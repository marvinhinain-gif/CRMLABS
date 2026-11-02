"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Eraser, Sparkles } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { plural } from "@/lib/format";
import type { BoardCleanupPreview } from "@/lib/types";
import { Avatar, Badge, Button, Dialog, EmptyState, ErrorState, LoadingState } from "@/components/ui";

const REASON_LABEL: Record<BoardCleanupPreview["items"][number]["reason"], string> = {
  sem_responsavel: "Sem responsável",
  sem_interacao: "Ninguém conversou",
};

/** Limpeza do Kanban do Social Seller (só administrador): tira do quadro cartões sem responsável ou sem conversa. */
export function BoardCleanupDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, error, isLoading, mutate } = useSWR<BoardCleanupPreview>(open ? "/api/board/cleanup" : null, fetcher, { revalidateOnFocus: false });
  const { mutate: gm } = useSWRConfig();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (!data?.total) return;
    setBusy(true);
    try {
      const r = await api.post<{ removed: number }>("/api/board/cleanup", { expectedTotal: data.total });
      toast.success(`${plural(r.removed, "cartão saiu", "cartões saíram")} do quadro. Os leads continuam em Leads.`);
      gm((k) => typeof k === "string" && (k.startsWith("/api/board") || k.startsWith("/api/cadence") || k.startsWith("/api/dashboard")));
      onOpenChange(false);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409) {
        toast.warning(err.message || "O quadro mudou, revise de novo.");
        mutate();
      } else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const total = data?.total ?? 0;
  const hidden = data ? Math.max(0, total - data.items.length) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="Limpar quadro"
      description="Saem do quadro os cartões sem responsável ou que ninguém conversou ainda. O lead não é apagado: continua em Leads e pode voltar ao quadro."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {total > 0 && (
            <Button variant="danger" icon={<Eraser className="size-4" />} loading={busy} onClick={confirm}>
              Tirar {plural(total, "cartão", "cartões")} do quadro
            </Button>
          )}
        </>
      }
    >
      {error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingState rows={4} />
      ) : total === 0 ? (
        <EmptyState icon={<Sparkles />} title="Nada para limpar" description="Todos os cartões do quadro têm responsável e alguém já conversou com eles." />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-[16px] border border-[#f1d9a6] bg-warning-soft px-4 py-3 text-[13.5px] text-[#6b4a00]">
            <p>
              <b className="font-semibold">{plural(total, "cartão vai sair", "cartões vão sair")} do quadro.</b> Fica no quadro só quem tem responsável <b>e</b> já teve conversa: mensagem enviada, nota, mudança de etapa feita por alguém, resposta a comentário, cadência, reunião, oportunidade ou tarefa.
            </p>
          </div>

          <section>
            <h3 className="mb-2 text-[14px] font-semibold">Por etapa</h3>
            <ul className="flex flex-wrap gap-2">
              {data.byStage.map((s) => (
                <li key={s.stageId} className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[13px] font-medium" style={{ background: `var(--stage-${s.color}-bg)`, color: "#24343d" }}>
                  <span className="size-2 rounded-full" style={{ background: `var(--stage-${s.color}-dot)` }} aria-hidden />
                  {s.stageName}
                  <span className="rounded-full bg-white/80 px-1.5 text-[12px] font-semibold">{s.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="mb-2 text-[14px] font-semibold">Cartões que saem</h3>
            <ul className="flex flex-col divide-y divide-line rounded-[16px] border border-line">
              {data.items.map((it) => (
                <li key={it.entryId} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Avatar name={it.name} src={it.avatarUrl} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{it.name}</span>
                    <span className="block truncate text-[12.5px] text-muted">
                      {[it.username && `@${it.username}`, it.stageName, it.ownerName ? `Resp.: ${it.ownerName}` : null].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <Badge tone={it.reason === "sem_responsavel" ? "warning" : "neutral"} className="shrink-0 text-[12px]">
                    {REASON_LABEL[it.reason]}
                  </Badge>
                </li>
              ))}
            </ul>
            {hidden > 0 && <p className="mt-2 text-center text-[12.5px] text-muted">E mais {plural(hidden, "cartão", "cartões")} (a lista mostra os 200 primeiros).</p>}
          </section>
        </div>
      )}
    </Dialog>
  );
}
