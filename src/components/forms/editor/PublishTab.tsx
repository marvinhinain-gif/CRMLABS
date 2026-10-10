"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CircleAlert, ExternalLink, Inbox, RefreshCw, Rocket, Undo2 } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Dialog } from "@/components/ui";
import { EmbedCodes, StatusBadge, type FormDetail } from "../shared";
import { Panel, TagInput } from "./common";

const ACTION_LABEL: Record<string, string> = {
  "form.created": "Formulário criado",
  "form.draft_saved": "Rascunho salvo",
  "form.scoring_draft_changed": "Regras de pontuação alteradas no rascunho",
  "form.published": "Publicado",
  "form.scoring_published": "Novas regras de pontuação publicadas",
  "form.unpublished": "Despublicado",
  "form.archived": "Arquivado",
  "form.restored": "Restaurado",
  "form.duplicated": "Duplicado",
  "form.recalculated": "Score recalculado",
  "form.exported": "Respostas exportadas",
};

type HistoryRow = { id: string; action: string; data: Record<string, unknown> | null; createdAt: string; actorName: string | null };

function historyDetail(r: HistoryRow) {
  const d = r.data ?? {};
  if (r.action === "form.draft_saved" && Array.isArray(d.changes)) return (d.changes as string[]).join(", ");
  if (r.action === "form.published" && d.version) return `Versão ${d.version}`;
  if (r.action === "form.recalculated") return `Versão ${d.version} · ${d.submissions} respostas, ${d.changed} mudaram`;
  if (r.action === "form.exported") return `${String(d.format).toUpperCase()} · ${d.rows} linhas`;
  return "";
}

export function PublishTab({
  form,
  dirty,
  busy,
  onPublish,
  onUnpublish,
  domains,
  setDomains,
}: {
  form: FormDetail;
  dirty: boolean;
  busy: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  domains: string[];
  setDomains: (v: string[]) => void;
}) {
  const { data: history, mutate: refreshHistory } = useSWR<HistoryRow[]>(`/api/forms/${form.id}/history`, fetcher);
  const [recalcOpen, setRecalcOpen] = useState(false);
  const [recalcBusy, setRecalcBusy] = useState(false);
  const recalc = async () => {
    setRecalcBusy(true);
    try {
      const r = await api.post<{ version: number; recalculated: number; changed: number }>(`/api/forms/${form.id}/recalculate`, {});
      toast.success(`${r.recalculated} resposta${r.recalculated === 1 ? "" : "s"} recalculada${r.recalculated === 1 ? "" : "s"} com a versão ${r.version}; ${r.changed} mudaram de score ou faixa.`);
      setRecalcOpen(false);
      refreshHistory();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRecalcBusy(false);
    }
  };
  const pending = dirty || form.hasUnpublishedChanges;
  const archived = form.status === "archived";

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Status">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={form.status} live={form.live} pending={pending} />
            {form.liveVersion && <span className="text-[13.5px] text-muted">No ar: versão {form.liveVersion}{form.publishedAt ? ` · publicada em ${formatDateTime(form.publishedAt)}` : ""}</span>}
          </div>
          {form.problems.length > 0 && (
            <div className="rounded-[16px] border border-warning/30 bg-warning-soft p-3 text-[13.5px]">
              <p className="mb-1 flex items-center gap-1.5 font-semibold text-warning">
                <CircleAlert className="size-4" aria-hidden /> Antes de publicar
              </p>
              <ul className="list-disc pl-5 text-ink">
                {form.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon={<Rocket className="size-4" />} onClick={onPublish} loading={busy} disabled={archived || form.problems.length > 0 || (!pending && form.live)}>
              {form.live ? (pending ? "Publicar alterações" : "Publicado") : "Publicar"}
            </Button>
            {form.live && (
              <Button variant="secondary" icon={<Undo2 className="size-4" />} onClick={onUnpublish} disabled={busy}>
                Despublicar
              </Button>
            )}
            {form.live && (
              <Button variant="ghost" icon={<ExternalLink className="size-4" />} onClick={() => window.open(form.publicUrl, "_blank", "noopener")}>
                Abrir formulário
              </Button>
            )}
          </div>
          <p className="text-[12.5px] text-muted">
            Publicar cria uma nova versão de uma vez só: quem já está respondendo termina na versão que abriu, e as respostas guardam a versão usada. Despublicar mostra “Formulário indisponível” no link.
          </p>
        </div>
      </Panel>

      <Panel title="Link e incorporação">
        {!form.live && <p className="mb-3 rounded-[14px] bg-page px-3 py-2 text-[13px] text-muted">O link e o código já estão prontos e passam a funcionar quando você publicar.</p>}
        <EmbedCodes form={form} />
      </Panel>

      <Panel title="Sites autorizados a incorporar" description="Sem nenhum domínio, o formulário pode ser incorporado em qualquer site. Com domínios, só neles.">
        <TagInput value={domains} onChange={setDomains} placeholder="meusite.com.br, *.minhaempresa.com" />
        <p className="mt-2 text-[12.5px] text-muted">Salve o rascunho para aplicar. Vale na hora, sem precisar publicar.</p>
      </Panel>

      <Panel
        title="Versões publicadas"
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={`/formularios/${form.id}/respostas`} className="inline-flex h-9 items-center gap-2 rounded-[12px] border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-page">
              <Inbox className="size-4" aria-hidden /> Respostas ({form.responses})
            </Link>
            <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" />} disabled={!form.versions.length || !form.responses} onClick={() => setRecalcOpen(true)}>
              Recalcular score
            </Button>
          </div>
        }
      >
        {!form.versions.length ? (
          <p className="text-[13.5px] text-muted">Nenhuma versão publicada ainda.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {form.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13.5px]">
                <span className="flex items-center gap-2">
                  <b>Versão {v.version}</b>
                  {v.version === form.liveVersion && form.live && <Badge tone="success">No ar</Badge>}
                </span>
                <span className="text-muted">
                  {formatDateTime(v.publishedAt)}
                  {v.publishedBy ? ` · ${v.publishedBy}` : ""}
                  {v.maxPoints ? ` · ${v.maxPoints} pts` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Histórico de alterações">
        {!history ? (
          <p className="text-[13.5px] text-muted">Carregando…</p>
        ) : !history.length ? (
          <p className="text-[13.5px] text-muted">Sem alterações registradas.</p>
        ) : (
          <ul className="flex max-h-80 flex-col divide-y divide-line overflow-y-auto scroll-thin">
            {history.map((h) => (
              <li key={h.id} className="py-2.5 text-[13.5px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{ACTION_LABEL[h.action] ?? h.action}</span>
                  <span className="text-[12.5px] text-muted">
                    {formatDateTime(h.createdAt)}
                    {h.actorName ? ` · ${h.actorName}` : ""}
                  </span>
                </div>
                {historyDetail(h) && <p className="text-[12.5px] text-muted">{historyDetail(h)}</p>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog
        open={recalcOpen}
        onOpenChange={setRecalcOpen}
        size="sm"
        title="Recalcular o score das respostas?"
        description={`Usa as regras da versão ${form.versions[0]?.version ?? ""} (a última publicada).`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRecalcOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={recalc} loading={recalcBusy}>
              Recalcular
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-[13.5px] text-muted">
          <li>O score original de cada resposta continua guardado no histórico.</li>
          <li>As etiquetas de faixa do contato acompanham a nova classificação.</li>
          <li>Ninguém muda de funil nem de responsável: isso continua sendo decisão comercial.</li>
          {dirty && <li className="text-warning">Há alterações não publicadas: elas não entram no recálculo.</li>}
        </ul>
      </Dialog>
    </div>
  );
}
