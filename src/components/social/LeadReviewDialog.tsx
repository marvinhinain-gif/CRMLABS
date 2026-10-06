"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { CheckCheck, MessageCircle, ShieldCheck, Trash2 } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { formatDateTime, shortAgo } from "@/lib/format";
import { Avatar, Button, Checkbox, cx, Dialog, EmptyState, LoadingState, StageChip } from "@/components/ui";
import { ChannelBadge } from "@/components/ui/ChannelIcon";

type Row = {
  entryId: string;
  createdAt: string;
  origin: string | null;
  stageName: string;
  stageColor: string;
  contactId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  ownerName: string | null;
  conversationId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  movedByTeam: boolean;
  repliedByTeam: boolean;
  hasTasksOrNotes: boolean;
};

/**
 * Revisão (administrador) dos cartões que entraram sozinhos no Kanban pela regra antiga.
 * Cada decisão é de uma pessoa: nada é removido automaticamente e nada é apagado.
 */
export function LeadReviewDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, mutate } = useSWR<{ rows: Row[] }>(open ? "/api/leads/review" : null, fetcher);
  const { mutate: gm } = useSWRConfig();
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = data?.rows ?? [];

  const review = async (entryIds: string[], action: "keep" | "remove") => {
    setBusy(true);
    try {
      const r = await api.post<{ updated: number }>("/api/leads/review", { entryIds, action });
      toast.success(action === "keep" ? `${r.updated} confirmado(s) como Lead.` : `${r.updated} removido(s) do Kanban. Contatos e conversas continuam no Instagram.`);
      setPicked((p) => p.filter((x) => !entryIds.includes(x)));
      setConfirmRemove(null);
      mutate();
      gm((k) => typeof k === "string" && (k.startsWith("/api/board") || k.startsWith("/api/instagram") || k.startsWith("/api/contacts") || k.startsWith("/api/conversations")));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Revisar Leads criados automaticamente"
      description="Estes cartões entraram no Kanban só porque a pessoa mandou mensagem ou comentou (regra antiga). Decida um a um: nada é apagado — contato, conversa e histórico continuam."
      footer={
        confirmRemove ? (
          <>
            <p className="mr-auto self-center text-[13px] text-muted">Remover {confirmRemove.length} cartão(ões) do Kanban?</p>
            <Button variant="secondary" onClick={() => setConfirmRemove(null)}>
              Voltar
            </Button>
            <Button variant="danger" loading={busy} icon={<Trash2 className="size-4" />} onClick={() => review(confirmRemove, "remove")}>
              Confirmar remoção
            </Button>
          </>
        ) : (
          <>
            <span className="mr-auto self-center text-[13px] text-muted">{picked.length ? `${picked.length} selecionado(s)` : `${rows.length} para revisar`}</span>
            <Button variant="secondary" disabled={!picked.length || busy} icon={<ShieldCheck className="size-4" />} onClick={() => review(picked, "keep")}>
              Manter como Lead
            </Button>
            <Button variant="secondary" disabled={!picked.length || busy} icon={<Trash2 className="size-4" />} onClick={() => setConfirmRemove(picked)}>
              Remover do Kanban
            </Button>
          </>
        )
      }
    >
      {!data ? (
        <LoadingState rows={4} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<CheckCheck />} title="Nada para revisar" description="Nenhum cartão automático no Kanban. Daqui para frente, só entra quem for transformado em Lead." />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const signals = [r.repliedByTeam && "Respondida pela equipe", r.movedByTeam && "Movido por alguém da equipe", r.hasTasksOrNotes && "Tem tarefas ou anotações"].filter(Boolean) as string[];
            return (
              <li key={r.entryId} className={cx("flex gap-3 py-3", picked.includes(r.entryId) && "bg-selected/40 -mx-2 px-2 rounded-[12px]")}>
                <div className="pt-2.5">
                  <Checkbox label={<span className="sr-only">Selecionar {r.name}</span>} checked={picked.includes(r.entryId)} onChange={() => toggle(r.entryId)} />
                </div>
                <span className="relative shrink-0">
                  <Avatar name={r.name} src={r.avatarUrl} size={40} />
                  <ChannelBadge />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-[14.5px] font-semibold">{r.name}</p>
                    {r.username && <span className="text-[12.5px] text-muted">@{r.username}</span>}
                    <StageChip name={r.stageName} color={r.stageColor} />
                  </div>
                  <p className="mt-0.5 truncate text-[13px] text-muted">
                    {r.lastMessagePreview ? `“${r.lastMessagePreview}”` : r.origin === "instagram_comment" ? "Entrou por comentário" : "Entrou por mensagem"}
                    {r.lastMessageAt && ` · ${shortAgo(r.lastMessageAt)}`}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
                    <span className="text-muted">Entrou em {formatDateTime(r.createdAt)}</span>
                    {signals.map((s) => (
                      <span key={s} className="rounded-full bg-info-soft px-2 py-0.5 text-info">
                        {s}
                      </span>
                    ))}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                  {r.conversationId && (
                    <Link href={`/instagram?aba=directs&c=${r.conversationId}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">
                      <MessageCircle className="size-3.5" aria-hidden /> Conversa
                    </Link>
                  )}
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => review([r.entryId], "keep")}>
                    Manter
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove([r.entryId])}>
                    Remover
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}
