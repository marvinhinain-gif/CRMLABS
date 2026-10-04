"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { BadgeCheck, ChevronLeft, ChevronRight, FileUp, Merge, Plus, Search, Users } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import type { Stage } from "@/lib/types";
import { formatDate, relativeTime } from "@/lib/format";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, PageHeader, DemoBadge, Select, StageChip } from "@/components/ui";
import { NewContactDialog } from "./NewContactDialog";

type Row = {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  phone: string | null;
  source: string;
  ownerName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastInteractionAt: string | null;
  stageName: string | null;
  stageColor: string | null;
  hasOfficialIdentity: boolean;
};
type List = { rows: Row[]; total: number; page: number; pageSize: number };

const SOURCES: Record<string, string> = { manual: "Manual", instagram_dm: "Direct", instagram_comment: "Comentário", import: "Importação" };

type Preview = {
  rows: { line: number; data: { name: string; username: string | null; email: string | null }; errors: string[]; duplicateOf: { id: string; name: string } | null; duplicateInFile: number | null }[];
  summary: { total: number; valid: number; invalid: number; duplicates: number };
};

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const team = useTeam();
  const { data: stages } = useSWR<Stage[]>(open ? "/api/stages?kind=relationship" : null, fetcher);
  const { mutate } = useSWRConfig();
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [stageId, setStageId] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<{ created: number; skippedInvalid: number; skippedDuplicate: number } | null>(null);
  useEffect(() => {
    if (!open) {
      setCsv("");
      setPreview(null);
      setReport(null);
      setFileName("");
    }
  }, [open]);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) return toast.error("Arquivo maior que 2 MB.");
    setFileName(f.name);
    const text = await f.text();
    setCsv(text);
    setLoading(true);
    try {
      setPreview(await api.post<Preview>("/api/contacts/import/preview", { csv: text }));
    } catch (e) {
      toast.error((e as Error).message);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };
  const commit = async () => {
    setLoading(true);
    try {
      const r = await api.post<{ created: number; skippedInvalid: number; skippedDuplicate: number }>("/api/contacts/import", { csv, ownerId: ownerId || null, stageId: stageId || null });
      setReport(r);
      mutate((k) => typeof k === "string" && (k.startsWith("/api/contacts") || k.startsWith("/api/board")));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Importar contatos (CSV)"
      description='Colunas reconhecidas: nome (obrigatória), instagram ou @, email, telefone, perfil, resumo, tags. Duplicidades são detectadas por @, e-mail e telefone — nunca só pelo nome.'
      footer={
        report ? (
          <Button onClick={() => onOpenChange(false)}>Concluir</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={commit} loading={loading} disabled={!preview || preview.summary.valid === 0}>
              Importar {preview ? preview.summary.valid : ""} contato(s)
            </Button>
          </>
        )
      }
    >
      {report ? (
        <div className="rounded-[16px] bg-selected p-5 text-[14.5px]" role="status">
          <p className="font-semibold text-brand-dark">Importação concluída</p>
          <p className="mt-1">
            {report.created} criado(s) · {report.skippedDuplicate} duplicado(s) ignorado(s) · {report.skippedInvalid} linha(s) com erro.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[18px] border-2 border-dashed border-[#bfd6cf] bg-page/60 px-6 py-8 text-center hover:bg-page">
            <FileUp className="size-7 text-brand" aria-hidden />
            <span className="text-[14.5px] font-medium">{fileName || "Escolher arquivo .csv"}</span>
            <span className="text-[12.5px] text-muted">Até 2 MB e 2.000 linhas</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          {loading && !preview && <LoadingState rows={2} />}
          {preview && (
            <>
              <div className="flex flex-wrap gap-2">
                <Badge tone="success">{preview.summary.valid} válida(s)</Badge>
                <Badge tone="warning">{preview.summary.duplicates} duplicada(s)</Badge>
                <Badge tone="danger">{preview.summary.invalid} com erro</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Responsável dos novos contatos" htmlFor="imp-owner">
                  <Select id="imp-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                    <option value="">Sem responsável</option>
                    {team
                      .filter((m) => m.status === "active")
                      .map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="Adicionar ao quadro em" htmlFor="imp-stage">
                  <Select id="imp-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                    <option value="">Não adicionar</option>
                    {stages?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="max-h-[300px] overflow-auto rounded-[14px] border border-line">
                <table className="w-full text-left text-[13px]">
                  <thead className="sticky top-0 bg-page">
                    <tr>
                      <th className="px-3 py-2 font-medium">Linha</th>
                      <th className="px-3 py-2 font-medium">Nome</th>
                      <th className="px-3 py-2 font-medium">@ / e-mail</th>
                      <th className="px-3 py-2 font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.line} className="border-t border-line">
                        <td className="px-3 py-2 text-muted">{r.line}</td>
                        <td className="px-3 py-2">{r.data.name || "—"}</td>
                        <td className="px-3 py-2 text-muted">{[r.data.username && `@${r.data.username}`, r.data.email].filter(Boolean).join(" · ") || "—"}</td>
                        <td className="px-3 py-2">
                          {r.errors.length ? (
                            <span className="text-danger">{r.errors.join(", ")}</span>
                          ) : r.duplicateOf ? (
                            <span className="text-warning">Já existe: {r.duplicateOf.name}</span>
                          ) : r.duplicateInFile ? (
                            <span className="text-warning">Repete a linha {r.duplicateInFile}</span>
                          ) : (
                            <span className="text-success">Será criada</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

function MergeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [qa, setQa] = useState("");
  const [qb, setQb] = useState("");
  const [a, setA] = useState<Row | null>(null);
  const [b, setB] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const { mutate } = useSWRConfig();
  const { data: ra } = useSWR<List>(open && qa.length >= 2 && !a ? `/api/contacts${qs({ q: qa, pageSize: 5 })}` : null, fetcher);
  const { data: rb } = useSWR<List>(open && qb.length >= 2 && !b ? `/api/contacts${qs({ q: qb, pageSize: 5 })}` : null, fetcher);
  useEffect(() => {
    if (!open) {
      setA(null);
      setB(null);
      setQa("");
      setQb("");
    }
  }, [open]);
  const merge = async () => {
    if (!a || !b) return;
    setLoading(true);
    try {
      await api.post("/api/contacts/merge", { primaryId: a.id, secondaryId: b.id });
      toast.success("Contatos mesclados. O histórico foi preservado.");
      mutate((k) => typeof k === "string" && (k.startsWith("/api/contacts") || k.startsWith("/api/board")));
      onOpenChange(false);
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setLoading(false);
    }
  };
  const Picker = ({ label, q, setQ, pick, picked, list, id }: { label: string; q: string; setQ: (v: string) => void; pick: (r: Row | null) => void; picked: Row | null; list?: List; id: string }) => (
    <Field label={label} htmlFor={id}>
      {picked ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-brand bg-selected/50 px-3 py-2">
          <Avatar name={picked.name} size={32} />
          <span className="flex-1 text-[14px] font-medium">{picked.name}</span>
          <Button size="sm" variant="ghost" onClick={() => pick(null)}>
            Trocar
          </Button>
        </div>
      ) : (
        <>
          <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, @ ou e-mail" />
          {list?.rows.map((r) => (
            <button key={r.id} onClick={() => pick(r)} className="mt-1 flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[14px] hover:bg-page">
              <Avatar name={r.name} size={28} /> {r.name} <span className="text-muted text-[12.5px]">{r.username ? `@${r.username}` : r.email}</span>
            </button>
          ))}
        </>
      )}
    </Field>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Mesclar contatos"
      description="Use apenas quando os dois registros forem comprovadamente da mesma pessoa. A ação é registrada na auditoria."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={merge} loading={loading} disabled={!a || !b || a.id === b.id}>
            Mesclar no principal
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Picker label="Contato principal (permanece)" q={qa} setQ={setQa} pick={setA} picked={a} list={ra} id="mg-a" />
        <Picker label="Contato a mesclar (será arquivado)" q={qb} setQ={setQb} pick={setB} picked={b} list={rb} id="mg-b" />
        <p className="text-[12.5px] text-muted">Identidades oficiais, conversas, oportunidades, tarefas, notas e tags passam ao principal. Campos vazios do principal são completados.</p>
      </div>
    </Dialog>
  );
}

export function ContactsView() {
  const me = useMe();
  const team = useTeam();
  const openContact = useOpenContact();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [source, setSource] = useQueryParam("origem", "");
  const [stageId, setStageId] = useQueryParam("etapa", "");
  const [novos, setNovos] = useQueryParam("novos", "");
  const [page, setPage] = useState(1);
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const { data: stages } = useSWR<Stage[]>("/api/stages?kind=relationship", fetcher);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  const { data, error, isLoading, mutate } = useSWR<List>(`/api/contacts${qs({ q: debounced, ownerId: owner, source, stageId, novosInteressados: novos, page, pageSize: 25 })}`, fetcher, { keepPreviousData: true });
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title="Contatos"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle="Todas as pessoas com quem sua equipe se relaciona."
        actions={
          <>
            {me.permissions.merge && (
              <Button variant="secondary" icon={<Merge className="size-4" />} onClick={() => setMergeOpen(true)}>
                Mesclar
              </Button>
            )}
            {me.permissions.import && (
              <Button variant="secondary" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>
                Importar CSV
              </Button>
            )}
            <Button icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>
              Novo contato
            </Button>
          </>
        }
      />
      <Card className="p-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, @, e-mail ou telefone" aria-label="Buscar contatos" className="h-11 w-full rounded-[14px] border border-line pl-11 pr-3 text-[14px] focus:border-brand focus:outline-none" />
        </div>
        {me.permissions.dataAll && (
          <Select aria-label="Responsável" value={owner} onChange={(e) => (setOwner(e.target.value), setPage(1))} className="lg:w-[200px]">
            <option value="">Todos os responsáveis</option>
            {team.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
        <Select aria-label="Etapa" value={stageId} onChange={(e) => (setStageId(e.target.value), setPage(1))} className="lg:w-[200px]">
          <option value="">Todas as etapas</option>
          {stages?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Origem" value={source} onChange={(e) => (setSource(e.target.value), setPage(1))} className="lg:w-[170px]">
          <option value="">Todas as origens</option>
          {Object.entries(SOURCES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
      </Card>
      {novos && (
        <div className="flex items-center justify-between rounded-[14px] bg-selected px-4 py-2.5 text-[13.5px] text-brand-dark">
          Mostrando novos interessados do período selecionado no dashboard.
          <button className="font-semibold underline" onClick={() => setNovos(null)}>
            Remover filtro
          </button>
        </div>
      )}
      <Card className="overflow-hidden">
        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <LoadingState rows={6} className="p-4" />
        ) : !data?.rows.length ? (
          <EmptyState icon={<Users />} title="Nenhum contato encontrado" description={debounced || owner || source || stageId ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro contato ou importe uma lista."} action={<Button icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>Novo contato</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead>
                  <tr className="border-b border-line bg-page/60 text-[13px] text-muted">
                    <th className="px-5 py-3 font-medium">Contato</th>
                    <th className="px-3 py-3 font-medium">Etapa</th>
                    <th className="px-3 py-3 font-medium">Responsável</th>
                    <th className="px-3 py-3 font-medium">Origem</th>
                    <th className="px-3 py-3 font-medium">Última interação</th>
                    <th className="px-3 py-3 font-medium">Criado em</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0 hover:bg-page/50 cursor-pointer" onClick={() => openContact(r.id)}>
                      <td className="px-5 py-3">
                        <button className="flex items-center gap-3 text-left" onClick={(e) => (e.stopPropagation(), openContact(r.id))}>
                          <Avatar name={r.name} src={r.avatarUrl} size={40} />
                          <span>
                            <span className="flex items-center gap-1.5 text-[14.5px] font-semibold">
                              {r.name}
                              {r.hasOfficialIdentity && <BadgeCheck className="size-4 text-success" aria-label="Identidade oficial do Instagram" />}
                            </span>
                            <span className="block text-[12.5px] text-muted">{[r.username && `@${r.username}`, r.email, r.phone].filter(Boolean).join(" · ") || "—"}</span>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3">{r.stageName ? <StageChip name={r.stageName} color={r.stageColor} /> : <span className="text-[13px] text-muted">Fora do quadro</span>}</td>
                      <td className="px-3 py-3 text-[14px]">{r.ownerName ?? <span className="text-muted">—</span>}</td>
                      <td className="px-3 py-3 text-[13.5px] text-muted">{SOURCES[r.source] ?? r.source}</td>
                      <td className="px-3 py-3 text-[13.5px] text-muted">{r.lastInteractionAt ? relativeTime(r.lastInteractionAt) : "—"}</td>
                      <td className="px-3 py-3 text-[13.5px] text-muted">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13.5px] text-muted">
              <span>
                {data.total} contato(s) · página {data.page} de {pages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} icon={<ChevronLeft className="size-4" />}>
                  Anterior
                </Button>
                <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  Próxima <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
      <NewContactDialog open={newOpen} onOpenChange={setNewOpen} defaultStageId={null} onCreated={openContact} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <MergeDialog open={mergeOpen} onOpenChange={setMergeOpen} />
    </div>
  );
}
