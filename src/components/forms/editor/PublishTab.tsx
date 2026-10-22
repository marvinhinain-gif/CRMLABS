"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CircleAlert, ExternalLink, Inbox, Link2, Plus, RefreshCw, Rocket, Trash2, Undo2 } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { personalLink } from "@/lib/quiz/instagramLink";
import { LINK_KIND_LABEL, type LinkKind, type SourceLink } from "@/lib/quiz/types";
import { Badge, Button, Dialog, Field, IconButton, Input, Select } from "@/components/ui";
import { CopyField, EmbedCodes, StatusBadge, type EditorOptions, type FormDetail } from "../shared";
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

const NEW_SOURCE = "__nova__";

/** Origem usada quando o link fica em "Padrão do tipo" (igual ao servidor). */
const DEFAULT_SOURCE_NAME: Record<LinkKind, string> = {
  stories: "Stories",
  whatsapp_group: "Grupo de WhatsApp",
  traffic: "Tráfego Pago",
  bio: "Conteúdo Orgânico",
  direct: "Conteúdo Orgânico",
  other: "a do formulário",
};

const KIND_UTM: Record<LinkKind, [string, string]> = {
  stories: ["instagram", "stories"],
  whatsapp_group: ["whatsapp", "grupo"],
  traffic: ["meta", "cpc"],
  bio: ["instagram", "bio"],
  direct: ["instagram", "direct"],
  other: ["", ""],
};

const keyOf = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/--+/g, "-")
    .slice(0, 40);

/** Instagram de quem responde, sem perguntar: link personalizado com ?ig= e origem automática. */
function InstagramPanel({ form }: { form: FormDetail }) {
  const direct = form.links.find((l) => l.kind === "direct")?.key ?? null;
  return (
    <Panel
      title="Instagram de quem responde (sem perguntar)"
      description="O Instagram não conta para nenhum site quem clicou num link comum (Stories, bio, anúncio). Por isso o @ chega de duas formas:"
    >
      <ul className="flex list-disc flex-col gap-2 pl-5 text-[13.5px] text-ink">
        <li>
          <b>Pelo Direct do CRM:</b> nas Conversas e na resposta privada de comentários, o botão <b>Enviar formulário</b> coloca na mensagem um link com o @ da pessoa. A resposta chega
          ligada ao Instagram dela e ao histórico do contato, mesmo sem a pergunta de Instagram.
        </li>
        <li>
          <b>Por automação (ex.: ManyChat):</b> acrescente <code className="rounded bg-page px-1">?ig=</code> e o @ da pessoa no fim do link, como em{" "}
          <code className="break-all rounded bg-page px-1">{personalLink(form.publicUrl, "fulano", direct)}</code>, usando a variável de usuário do Instagram da sua ferramenta.
        </li>
        <li>
          <b>Link comum aberto pelo app do Instagram:</b> não dá para saber o @, mas a resposta fica com origem <b>Instagram</b> automaticamente (quando o link não tem outra UTM).
        </li>
      </ul>
    </Panel>
  );
}

/** Links de origem: o mesmo formulário divulgado em Stories, grupos, anúncios… cada um com sua origem no CRM. */
function LinksPanel({ form, links, setLinks, sources }: { form: FormDetail; links: SourceLink[]; setLinks: (v: SourceLink[]) => void; sources: EditorOptions["sources"] }) {
  const set = (i: number, p: Partial<SourceLink>) => setLinks(links.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const add = () => {
    let key = "novo-link";
    for (let n = 2; links.some((l) => l.key === key); n++) key = `novo-link-${n}`;
    setLinks([...links, { key, label: "Novo link", kind: "other", sourceId: null, utmSource: null, utmMedium: null, utmCampaign: null }]);
  };
  const saved = (l: SourceLink) => form.links.some((x) => x.key === l.key);
  return (
    <Panel
      title="Links de origem"
      description="Um link para cada lugar onde você divulga o quiz (Stories, Grupo de WhatsApp, Tráfego…). A resposta e o lead ficam marcados com essa origem, e os indicadores mostram quanto cada link trouxe."
    >
      <ul className="flex flex-col gap-3">
        {links.map((l, i) => {
          const url = `${form.publicUrl}?origem=${l.key}`;
          return (
            <li key={i} className="flex flex-col gap-3 rounded-[18px] border border-line p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_190px_auto]">
                <Field label="Nome do link" htmlFor={`lk-l-${i}`}>
                  <Input id={`lk-l-${i}`} value={l.label} maxLength={80} onChange={(e) => set(i, { label: e.target.value })} />
                </Field>
                <Field label="Tipo" htmlFor={`lk-k-${i}`}>
                  <Select
                    id={`lk-k-${i}`}
                    value={l.kind}
                    onChange={(e) => {
                      const kind = e.target.value as LinkKind;
                      const [src, med] = KIND_UTM[kind];
                      set(i, { kind, sourceId: null, newSourceName: null, utmSource: l.utmSource || src || null, utmMedium: l.utmMedium || med || null });
                    }}
                  >
                    {Object.entries(LINK_KIND_LABEL).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                </Field>
                <div className="flex items-end">
                  <IconButton label="Remover link" onClick={() => setLinks(links.filter((_, j) => j !== i))}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Chave no endereço" htmlFor={`lk-key-${i}`} hint="Aparece no link como ?origem=…">
                  <Input id={`lk-key-${i}`} value={l.key} maxLength={40} onChange={(e) => set(i, { key: keyOf(e.target.value) })} className="font-mono" />
                </Field>
                <Field
                  label="Origem no CRM"
                  htmlFor={`lk-s-${i}`}
                  hint={l.newSourceName != null ? "Escolha o nome abaixo. A origem é criada ao salvar." : "É o nome que aparece como origem do lead. Escolha uma existente ou crie com o seu nome."}
                >
                  <Select
                    id={`lk-s-${i}`}
                    value={l.newSourceName != null ? NEW_SOURCE : (l.sourceId ?? "")}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === NEW_SOURCE) set(i, { sourceId: null, newSourceName: l.label });
                      else set(i, { sourceId: v || null, newSourceName: null });
                    }}
                  >
                    <option value="">Padrão do tipo ({DEFAULT_SOURCE_NAME[l.kind]})</option>
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                    <option value={NEW_SOURCE}>+ Criar origem com nome próprio…</option>
                  </Select>
                </Field>
              </div>
              {l.newSourceName != null && (
                <Field label="Nome da nova origem" htmlFor={`lk-n-${i}`} hint="Ex.: Live de terça, Parceria com @fulano. Se já existir uma origem com esse nome, ela é usada.">
                  <Input id={`lk-n-${i}`} value={l.newSourceName} maxLength={60} autoFocus placeholder="Como quer chamar essa origem?" onChange={(e) => set(i, { newSourceName: e.target.value })} />
                </Field>
              )}
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="utm_source" htmlFor={`lk-us-${i}`}>
                  <Input id={`lk-us-${i}`} value={l.utmSource ?? ""} maxLength={120} onChange={(e) => set(i, { utmSource: e.target.value || null })} />
                </Field>
                <Field label="utm_medium" htmlFor={`lk-um-${i}`}>
                  <Input id={`lk-um-${i}`} value={l.utmMedium ?? ""} maxLength={120} onChange={(e) => set(i, { utmMedium: e.target.value || null })} />
                </Field>
                <Field label="utm_campaign" htmlFor={`lk-uc-${i}`}>
                  <Input id={`lk-uc-${i}`} value={l.utmCampaign ?? ""} maxLength={160} onChange={(e) => set(i, { utmCampaign: e.target.value || null })} />
                </Field>
              </div>
              {saved(l) ? (
                <CopyField label={`Link para ${l.label}`} value={url} what="Link copiado" />
              ) : (
                <p className="rounded-[14px] bg-page px-3 py-2 text-[13px] text-muted">Salve o rascunho para gerar o link {url}.</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {links.length < 40 && (
          <Button size="sm" variant="secondary" icon={<Plus className="size-4" />} onClick={add}>
            Adicionar link
          </Button>
        )}
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Link2 className="size-3.5" aria-hidden /> Vale na hora ao salvar, sem publicar. No site, use <code className="rounded bg-page px-1">data-crmlabs-origem=&quot;chave&quot;</code> no código de incorporação.
        </p>
      </div>
    </Panel>
  );
}

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
  links,
  setLinks,
  sources,
}: {
  form: FormDetail;
  dirty: boolean;
  busy: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  domains: string[];
  setDomains: (v: string[]) => void;
  links: SourceLink[];
  setLinks: (v: SourceLink[]) => void;
  sources: EditorOptions["sources"];
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

      <LinksPanel form={form} links={links} setLinks={setLinks} sources={sources} />

      <InstagramPanel form={form} />

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
