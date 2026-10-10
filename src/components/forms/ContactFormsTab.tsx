"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowLeft, ClipboardList, Download, Eraser } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { TierBadge } from "./shared";
import { SubmissionView } from "./SubmissionView";

type Row = {
  id: string;
  formId: string;
  formTitle: string;
  version: number;
  score: number | null;
  tierId: string | null;
  tierLabel: string | null;
  tierColor: string | null;
  completedAt: string;
  channel: string;
  origin: string;
  duplicateOf: string | null;
  anonymizedAt: string | null;
  historyCount: number;
};

/** Aba "Formulários respondidos" do contato. */
export function ContactFormsTab({ contactId }: { contactId: string }) {
  const me = useMe();
  const { data, error, mutate } = useSWR<Row[]>(`/api/contacts/${contactId}/forms`, fetcher);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isAdmin = me.user.role === "admin";

  const anonymize = async () => {
    if (!window.confirm("Anonimizar as respostas de formulário deste contato? Nome, contatos e respostas abertas são apagados das respostas (pedido do titular, LGPD). Score e classificação ficam só para estatística. Não dá para desfazer.")) return;
    setBusy(true);
    try {
      const r = await api.post<{ anonymized: number }>(`/api/contacts/${contactId}/forms/anonymize`);
      toast.success(`${r.anonymized} resposta${r.anonymized === 1 ? "" : "s"} anonimizada${r.anonymized === 1 ? "" : "s"}.`);
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (open)
    return (
      <div className="flex flex-col gap-4">
        <Button size="sm" variant="ghost" className="self-start" icon={<ArrowLeft className="size-4" />} onClick={() => setOpen(null)}>
          Voltar para a lista
        </Button>
        <SubmissionView id={open} />
      </div>
    );
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!data) return <LoadingState rows={2} />;
  return (
    <div className="flex flex-col gap-4">
      {!data.length ? (
        <EmptyState icon={<ClipboardList />} title="Nenhum formulário respondido" description="Quando este contato responder um formulário, as respostas, o score e a classificação aparecem aqui." />
      ) : (
        <ul className="flex flex-col gap-2.5">
          {data.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(r.id)} className="w-full rounded-[18px] border border-line p-4 text-left transition-colors hover:bg-page">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold">{r.formTitle}</span>
                    <span className="block text-[12.5px] text-muted">
                      {formatDateTime(r.completedAt)} · {r.origin} · versão {r.version}
                    </span>
                  </span>
                  {r.score !== null && (
                    <span className="text-right">
                      <span className="block text-[22px] font-bold leading-none">{r.score}</span>
                      <span className="text-[11px] text-muted">score</span>
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <TierBadge label={r.tierLabel} color={r.tierColor} />
                  {r.historyCount > 1 && <Badge tone="info">Recalculado</Badge>}
                  {r.duplicateOf && <Badge tone="warning">Envio repetido</Badge>}
                  {r.anonymizedAt && <Badge tone="neutral">Anonimizada</Badge>}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {isAdmin && data.length > 0 && (
        <div className="rounded-[18px] border border-line p-4">
          <p className="text-[14px] font-semibold">Direitos do titular (LGPD)</p>
          <p className="mt-0.5 text-[12.5px] text-muted">Para atender pedidos de acesso ou exclusão. As ações ficam registradas na auditoria.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={`/api/contacts/${contactId}/forms/export`} download className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-page">
              <Download className="size-4" aria-hidden /> Exportar dados (JSON)
            </a>
            <Button size="sm" variant="secondary" className="text-danger" icon={<Eraser className="size-4" />} loading={busy} disabled={data.every((r) => r.anonymizedAt)} onClick={anonymize}>
              Anonimizar respostas
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
