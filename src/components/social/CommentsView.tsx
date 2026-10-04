"use client";

import { useState } from "react";
import useSWRInfinite from "swr/infinite";
import useSWR from "swr";
import { toast } from "sonner";
import { CircleAlert, ExternalLink, Link2, Lock, MessageCircle, RefreshCw, Reply, SquareCheck, UserPlus } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import type { Stage } from "@/lib/types";
import { dayLabel, formatDateTime, relativeTime } from "@/lib/format";
import { Avatar, Badge, Button, Card, cx, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select, Textarea } from "@/components/ui";

type CommentRow = {
  id: string;
  text: string | null;
  authorUsername: string | null;
  commentedAt: string;
  status: "new" | "in_progress" | "replied" | "done" | "ignored";
  privateReplySentAt: string | null;
  contactId: string | null;
  contactName: string | null;
  postCaption: string | null;
  postPermalink: string | null;
  postThumbnail: string | null;
  postMediaType: string | null;
  accountUsername: string | null;
  replies: { id: string; kind: "public" | "private"; body: string; status: string; error: string | null; createdAt: string; sentByName: string | null }[];
  actions: { publicReply: boolean; privateReply: boolean; privateReplyBlockedReason: string | null };
};
type Page = { rows: CommentRow[]; nextCursor: string | null };

const STATUS: Record<CommentRow["status"], { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  new: { label: "Novo", tone: "info" },
  in_progress: { label: "Em atendimento", tone: "warning" },
  replied: { label: "Respondido", tone: "success" },
  done: { label: "Concluído", tone: "neutral" },
  ignored: { label: "Ignorado", tone: "neutral" },
};

function ReplyBox({ comment, kind, onDone }: { comment: CommentRow; kind: "public" | "private"; onDone: () => void }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [reqId, setReqId] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim()) return;
    setLoading(true);
    const id = reqId ?? crypto.randomUUID();
    setReqId(id);
    try {
      const r = await api.post<{ status: string; error: string | null }>(`/api/comments/${comment.id}/reply`, { kind, text, clientRequestId: id });
      if (r.status === "accepted") toast.success(kind === "public" ? "Resposta publicada no comentário." : "Resposta privada enviada no Direct.");
      else toast.error(r.error ?? "Não confirmado pelo Instagram.");
      setText("");
      setReqId(null);
      onDone();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== "network") setReqId(null);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-page/50 p-3">
      <label className="text-[12.5px] font-medium text-muted" htmlFor={`rb-${comment.id}-${kind}`}>
        {kind === "public" ? "Responder comentário (público, visível na publicação)" : "Enviar resposta privada (Direct, uma única vez)"}
      </label>
      <Textarea id={`rb-${comment.id}-${kind}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} className="min-h-[64px]" />
      <div className="flex justify-end">
        <Button size="sm" loading={loading} disabled={!text.trim()} onClick={submit}>
          {kind === "public" ? "Publicar resposta" : "Enviar no Direct"}
        </Button>
      </div>
    </div>
  );
}

function LinkDialog({ comment, open, onOpenChange, onDone }: { comment: CommentRow; open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const { data: stages } = useSWR<Stage[]>(open ? "/api/stages?kind=relationship" : null, fetcher);
  const [stageId, setStageId] = useState("");
  const [q, setQ] = useState("");
  const { data: found } = useSWR<{ rows: { id: string; name: string; username: string | null }[] }>(open && q.length >= 2 ? `/api/contacts${qs({ q, pageSize: 6 })}` : null, fetcher);
  const [loading, setLoading] = useState(false);
  const link = async (body: object) => {
    setLoading(true);
    try {
      await api.post(`/api/comments/${comment.id}/link`, body);
      toast.success("Comentário associado ao contato.");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Associar a contato" description={`Autor: ${comment.authorUsername ? "@" + comment.authorUsername : "desconhecido"}. A associação usa o identificador oficial do autor, não o nome.`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 rounded-[16px] border border-line p-4">
          <p className="text-[14px] font-semibold">Criar contato a partir do comentário</p>
          <Field label="Adicionar ao quadro em" htmlFor="lk-stage">
            <Select id="lk-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">Não adicionar ao quadro</option>
              {stages?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button icon={<UserPlus className="size-4" />} loading={loading} onClick={() => link({ createContact: true, stageId: stageId || null })}>
            Criar e associar
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <Field label="Ou associar a um contato existente" htmlFor="lk-q">
            <Input id="lk-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou @" />
          </Field>
          {found?.rows.map((c) => (
            <button key={c.id} onClick={() => link({ contactId: c.id })} className="flex items-center gap-3 rounded-[12px] border border-line px-3 py-2 text-left hover:bg-page">
              <Avatar name={c.name} size={32} />
              <span className="text-[14px] font-medium">{c.name}</span>
              <span className="text-[12.5px] text-muted">{c.username ? `@${c.username}` : ""}</span>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

function CommentCard({ c, onChanged }: { c: CommentRow; onChanged: () => void }) {
  const openContact = useOpenContact();
  const [mode, setMode] = useState<null | "public" | "private">(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const setStatus = async (status: CommentRow["status"]) => {
    try {
      await api.patch(`/api/comments/${c.id}`, { status });
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const createTask = async () => {
    try {
      await api.post("/api/tasks", { title: `Responder comentário de ${c.authorUsername ? "@" + c.authorUsername : "contato"}`, notes: c.text?.slice(0, 500) ?? null, contactId: c.contactId, dueAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString() });
      toast.success("Tarefa criada.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const st = STATUS[c.status];
  return (
    <Card as="article" className="p-5">
      <div className="flex gap-4">
        <div className="hidden sm:flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-page text-muted">
          {c.postThumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.postThumbnail} alt="Mídia de origem" className="size-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="px-2 text-center text-[11px]">{c.postMediaType ?? "Mídia"}</span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[14.5px] font-semibold">{c.authorUsername ? `@${c.authorUsername}` : "Autor desconhecido"}</p>
            <span className="text-[12.5px] text-muted" title={formatDateTime(c.commentedAt)}>
              {relativeTime(c.commentedAt)}
            </span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {c.contactName ? (
              <button onClick={() => openContact(c.contactId!)} className="text-[12.5px] font-medium text-brand hover:underline">
                Contato: {c.contactName}
              </button>
            ) : (
              <span className="text-[12.5px] text-muted">Sem contato associado</span>
            )}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[14.5px]">{c.text}</p>
          <p className="mt-1.5 truncate text-[12.5px] text-muted">
            Em: {c.postCaption ? `“${c.postCaption.slice(0, 90)}”` : "publicação"}
            {c.postPermalink && (
              <a href={c.postPermalink} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-brand hover:underline">
                ver publicação <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </p>
          {c.replies.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2 border-l-2 border-line pl-3">
              {c.replies.map((r) => (
                <li key={r.id} className="text-[13.5px]">
                  <span className="font-medium">{r.kind === "public" ? "Resposta pública" : "Resposta privada"}</span>
                  <span className="text-muted"> · {r.sentByName ?? "—"} · {dayLabel(r.createdAt)}</span>
                  <p>{r.body}</p>
                  {r.status === "accepted" ? (
                    <span className="text-[12px] text-success">Confirmada pelo Instagram</span>
                  ) : r.status === "pending" ? (
                    <span className="text-[12px] text-muted">Enviando…</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[12px] text-danger">
                      <CircleAlert className="size-3" aria-hidden /> {r.error}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {c.actions.publicReply ? (
              <Button size="sm" variant={mode === "public" ? "soft" : "secondary"} icon={<Reply className="size-4" />} onClick={() => setMode(mode === "public" ? null : "public")}>
                Responder comentário
              </Button>
            ) : null}
            {c.actions.privateReply ? (
              <Button size="sm" variant={mode === "private" ? "soft" : "secondary"} icon={<Lock className="size-4" />} onClick={() => setMode(mode === "private" ? null : "private")}>
                Enviar resposta privada
              </Button>
            ) : (
              c.actions.privateReplyBlockedReason && <span className="self-center text-[12px] text-muted">Resposta privada indisponível: {c.actions.privateReplyBlockedReason}</span>
            )}
            {!c.contactId && (
              <Button size="sm" variant="secondary" icon={<Link2 className="size-4" />} onClick={() => setLinkOpen(true)}>
                Associar a contato
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={<SquareCheck className="size-4" />} onClick={createTask}>
              Criar tarefa
            </Button>
            <Select aria-label="Status do atendimento" value={c.status} onChange={(e) => setStatus(e.target.value as CommentRow["status"])} className="h-9 w-auto text-[13px]">
              {Object.entries(STATUS).map(([v, s]) => (
                <option key={v} value={v}>
                  {s.label}
                </option>
              ))}
            </Select>
          </div>
          {mode && (
            <div className="mt-3">
              <ReplyBox
                comment={c}
                kind={mode}
                onDone={() => {
                  setMode(null);
                  onChanged();
                }}
              />
            </div>
          )}
        </div>
      </div>
      <LinkDialog comment={c} open={linkOpen} onOpenChange={setLinkOpen} onDone={onChanged} />
    </Card>
  );
}

export function CommentsView({ connected }: { connected: boolean }) {
  const me = useMe();
  const [status, setStatus] = useQueryParam("status", "all");
  const [syncing, setSyncing] = useState(false);
  const getKey = (i: number, prev: Page | null) => (prev && !prev.nextCursor ? null : `/api/comments${qs({ status, cursor: i ? prev?.nextCursor : undefined })}`);
  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite<Page>(getKey, fetcher);
  const rows = data?.flatMap((p) => p.rows) ?? [];
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post<{ media: number; newComments: number }>("/api/comments/sync");
      toast.success(`Sincronizado: ${r.media} mídia(s), ${r.newComments} comentário(s) novo(s).`);
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto bg-white">
          <option value="all">Todos os status</option>
          {Object.entries(STATUS).map(([v, s]) => (
            <option key={v} value={v}>
              {s.label}
            </option>
          ))}
        </Select>
        {me.permissions.dataAll && connected && (
          <Button variant="secondary" icon={<RefreshCw className="size-4" />} loading={syncing} onClick={sync}>
            Sincronizar mídias recentes
          </Button>
        )}
        <p className="text-[12.5px] text-muted">Comentários em mídias da conta profissional conectada, dentro da cobertura da API oficial.</p>
      </div>
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading ? (
        <LoadingState rows={4} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MessageCircle />}
            title={connected ? "Nenhum comentário por aqui" : "Instagram não conectado"}
            description={connected ? "Novos comentários chegam pelos webhooks oficiais. Gestores podem sincronizar as mídias recentes." : "Um administrador precisa conectar a conta profissional em Configurações → Integrações."}
          />
        </Card>
      ) : (
        <div className={cx("flex flex-col gap-3")}>
          {rows.map((c) => (
            <CommentCard key={c.id} c={c} onChanged={() => mutate()} />
          ))}
          {data?.[data.length - 1]?.nextCursor && (
            <Button variant="secondary" onClick={() => setSize(size + 1)}>
              Carregar mais
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
