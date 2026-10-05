"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import {
  ArrowLeft,
  AtSign,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Inbox,
  ListTodo,
  MessageSquareQuote,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  UserRound,
  UserRoundCheck,
} from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import { dayLabel, formatDateTime, relativeTime, shortAgo } from "@/lib/format";
import { Avatar, Button, cx, EmptyState, ErrorState, IconButton, LoadingState, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Sheet, StageChip, Textarea } from "@/components/ui";
import { ChannelBadge, InstagramGlyph } from "@/components/ui/ChannelIcon";
import { NewTaskDialog } from "@/components/tasks/TaskParts";
import { ForwardDialog } from "@/components/commercial/ForwardDialog";
import type { Stage } from "@/lib/types";

type ConvRow = {
  id: string;
  channel: string;
  unreadCount: number;
  pendingCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "in" | "out" | null;
  resolvedAt: string | null;
  lastInboundAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  contactId: string;
  contactName: string;
  contactUsername: string | null;
  avatarUrl: string | null;
  matchedText: string | null;
};
type ConvList = { rows: ConvRow[]; nextCursor: string | null };
type Att = { type: string; url?: string; previewUrl?: string; title?: string };
type Msg = { id: string; direction: "in" | "out"; body: string | null; attachments: Att[] | null; status: string; error: string | null; sentAt: string; sentByName: string | null };
type ConvDetail = {
  conversation: { id: string; ownerId: string | null; owner: { id: string; name: string } | null; accountUsername: string | null; unreadCount: number; status: string; contactId: string; resolvedAt: string | null; lastInboundAt: string | null; lastMessageDirection: "in" | "out" | null };
  contact: { id: string; name: string; username: string | null; avatarUrl: string | null };
  messages: Msg[];
  hasMore: boolean;
  historyNote: string | null;
  send: { allowed: true; humanAgent: boolean; windowEndsAt: string } | { allowed: false; reason: string; code: string };
};
export type LeadInfo = {
  contact: { id: string; name: string; username: string | null; avatarUrl: string | null; summary: string | null };
  isLead: boolean;
  origin: { name: string; color: string } | null;
  product: string | null;
  ownerName: string | null;
  stage: { name: string; color: string } | null;
  entry: { id: string; version: number; stageId: string } | null;
  opportunity: { id: string; status: string; stageName: string; closerName: string | null } | null;
  lastContactAt: string | null;
};

const isPending = (c: { lastMessageDirection: "in" | "out" | null; resolvedAt: string | null; lastInboundAt: string | null }) =>
  c.lastMessageDirection === "in" && (!c.resolvedAt || (c.lastInboundAt && c.resolvedAt < c.lastInboundAt));

function MessageStatus({ m, onReconcile, onResend }: { m: Msg; onReconcile: () => void; onResend: () => void }) {
  if (m.direction === "in") return null;
  switch (m.status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
          <Clock className="size-3" aria-hidden /> Enviando…
        </span>
      );
    case "accepted":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted" title="O Instagram aceitou a mensagem.">
          <Check className="size-3" aria-hidden /> Enviada
        </span>
      );
    case "delivered":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted">
          <CheckCheck className="size-3" aria-hidden /> Entregue
        </span>
      );
    case "read":
      return (
        <span className="inline-flex items-center gap-1 text-[11px] text-info">
          <CheckCheck className="size-3" aria-hidden /> Lida
        </span>
      );
    case "unconfirmed":
      return (
        <span className="flex flex-wrap items-center gap-2 text-[11px] text-warning">
          <CircleAlert className="size-3" aria-hidden /> {m.error ?? "Envio não confirmado."}
          {m.error?.includes("seguro reenviar") ? (
            <button onClick={onResend} className="font-semibold underline">
              Reenviar
            </button>
          ) : (
            <button onClick={onReconcile} className="font-semibold underline">
              Verificar envio
            </button>
          )}
        </span>
      );
    case "failed":
      return (
        <span className="flex flex-wrap items-center gap-2 text-[11px] text-danger">
          <CircleAlert className="size-3" aria-hidden /> {m.error ?? "Falhou."}
          {m.error !== "Reenviada em nova tentativa." && (
            <button onClick={onResend} className="font-semibold underline">
              Tentar novamente
            </button>
          )}
        </span>
      );
    default:
      return null;
  }
}

/** Conteúdo da mensagem conforme o que a API entrega: texto, foto, vídeo, áudio, compartilhamento, story. */
function MessageContent({ m }: { m: Msg }) {
  const out = m.direction === "out";
  const atts = m.attachments ?? [];
  const storyReply = atts.find((a) => a.type === "story_reply");
  const chip = (icon: React.ReactNode, label: string, url?: string) => (
    <a href={url} target="_blank" rel="noopener noreferrer" aria-disabled={!url} className={cx("mb-1 inline-flex items-center gap-1.5 rounded-[10px] px-2 py-1 text-[12px] font-medium", out ? "bg-white/15 text-white" : "bg-page text-muted", !url && "pointer-events-none")}>
      {icon} {label} {url && <ExternalLink className="size-3" aria-hidden />}
    </a>
  );
  return (
    <>
      {storyReply && <div>{chip(<Sparkles className="size-3.5" />, "Respondeu ao seu story", storyReply.url)}</div>}
      {atts
        .filter((a) => a.type !== "story_reply")
        .map((a, i) =>
          a.type === "image" && a.url ? (
            <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="mb-1 block overflow-hidden rounded-[12px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.previewUrl ?? a.url} alt="Foto enviada" className="max-h-[260px] w-auto max-w-full object-cover" loading="lazy" />
            </a>
          ) : a.type === "video" && a.url ? (
            <video key={i} src={a.url} controls preload="metadata" className="mb-1 max-h-[280px] max-w-full rounded-[12px]" />
          ) : a.type === "audio" && a.url ? (
            <audio key={i} src={a.url} controls preload="none" className="mb-1 max-w-[240px]" />
          ) : a.type === "share" || a.type === "ig_post" || a.type === "ig_reel" ? (
            <div key={i}>{chip(<ImageIcon className="size-3.5" />, a.title ? `Compartilhou: ${a.title.slice(0, 40)}` : "Compartilhou uma publicação", a.url)}</div>
          ) : a.type === "story_mention" ? (
            <div key={i}>{chip(<AtSign className="size-3.5" />, "Mencionou você no story", a.url)}</div>
          ) : (
            <div key={i}>{chip(<FileText className="size-3.5" />, "Anexo", a.url)}</div>
          ),
        )}
      {m.body ? <span className="whitespace-pre-wrap break-words">{m.body}</span> : !atts.length ? <em className="opacity-75">{m.error ?? "Mensagem sem texto"}</em> : null}
    </>
  );
}

// ---------- Painel do lead ----------
export function LeadPanel({ contactId, compact }: { contactId: string; compact?: boolean }) {
  const { data, mutate } = useSWR<LeadInfo>(`/api/contacts/${contactId}/lead`, fetcher);
  const { data: stages } = useSWR<Stage[]>("/api/stages?kind=relationship", fetcher);
  const { mutate: gm } = useSWRConfig();
  const openContact = useOpenContact();
  const [note, setNote] = useState("");
  const [noting, setNoting] = useState(false);
  const [task, setTask] = useState(false);
  const [forward, setForward] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!data) return <LoadingState rows={3} className="p-5" />;
  const c = data.contact;
  const createLead = async () => {
    setBusy(true);
    try {
      mutate(await api.post<LeadInfo>(`/api/contacts/${c.id}/lead`, { from: "direct" }), { revalidate: false });
      toast.success("Lead criado no funil do Social Seller.");
      gm((k) => typeof k === "string" && (k.startsWith("/api/board") || k.startsWith("/api/conversations")));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const move = async (stageId: string) => {
    if (!data.entry) return;
    try {
      await api.post(`/api/board/entries/${data.entry.id}/move`, { toStageId: stageId, expectedVersion: data.entry.version });
      toast.success("Etapa atualizada.");
      mutate();
      gm((k) => typeof k === "string" && k.startsWith("/api/board"));
    } catch (e) {
      toast.error((e as Error).message);
      mutate();
    }
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    try {
      await api.post(`/api/contacts/${c.id}/notes`, { body: note.trim() });
      setNote("");
      setNoting(false);
      toast.success("Anotação salva (visível só para a equipe).");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-start justify-between gap-3 py-2">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="text-right text-[13.5px] font-medium">{value ?? "—"}</dd>
    </div>
  );
  return (
    <div className={cx("flex flex-col gap-4", compact ? "p-4" : "p-5")}>
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Avatar name={c.name} src={c.avatarUrl} size={48} />
          <ChannelBadge />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[15.5px] font-semibold">{c.name}</p>
          {c.username && <p className="truncate text-[12.5px] text-muted">@{c.username}</p>}
        </div>
      </div>
      {data.isLead ? (
        <>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-selected px-2.5 py-1 text-[12px] font-semibold text-brand-dark">
              <UserRoundCheck className="size-3.5" aria-hidden /> Lead no CRM
            </span>
          </div>
          <dl className="divide-y divide-line rounded-[16px] border border-line px-3.5">
            {row("Origem", data.origin ? <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: `var(--stage-${data.origin.color}-dot)` }} aria-hidden />{data.origin.name}</span> : null)}
            {row("Produto", data.product)}
            {row("Responsável", data.ownerName)}
            {row("Etapa atual", data.opportunity?.status === "open" ? `${data.opportunity.stageName} (Comercial)` : data.stage ? <StageChip name={data.stage.name} color={data.stage.color} /> : null)}
            {row("Último contato", data.lastContactAt ? relativeTime(data.lastContactAt) : null)}
          </dl>
        </>
      ) : (
        <div className="rounded-[16px] border border-dashed border-[#bfd6cf] p-3.5 text-[13px] text-muted">
          Ainda não é lead. Crie o lead para acompanhar no funil, com responsável e histórico.
          <Button className="mt-3 w-full" icon={<Plus className="size-4" />} loading={busy} onClick={createLead}>
            Criar Lead
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" icon={<UserRound className="size-4" />} onClick={() => openContact(c.id)}>
          Ver Lead
        </Button>
        <Button size="sm" variant="secondary" icon={<ListTodo className="size-4" />} onClick={() => setTask(true)}>
          Criar tarefa
        </Button>
        <Button size="sm" variant="secondary" icon={<NotebookPen className="size-4" />} onClick={() => setNoting((v) => !v)}>
          Anotação
        </Button>
        {data.isLead && data.entry ? (
          <Menu>
            <MenuTrigger asChild>
              <Button size="sm" variant="secondary" icon={<Sparkles className="size-4" />}>
                Qualificar
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuLabel>Mover no funil</MenuLabel>
              {stages?.map((s) => (
                <MenuItem key={s.id} disabled={s.id === data.entry?.stageId} onSelect={() => move(s.id)}>
                  <span className="size-2 rounded-full" style={{ background: `var(--stage-${s.color}-dot)` }} aria-hidden />
                  {s.name}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem icon={<Send />} onSelect={() => setForward(true)}>
                Encaminhar para Closer
              </MenuItem>
            </MenuContent>
          </Menu>
        ) : (
          <Button size="sm" variant="secondary" icon={<Send className="size-4" />} onClick={() => setForward(true)}>
            Encaminhar
          </Button>
        )}
      </div>
      {noting && (
        <div className="flex flex-col gap-2">
          <Textarea autoFocus aria-label="Anotação" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visível só para a equipe. Nunca vai para o Instagram." className="min-h-[72px]" />
          <Button size="sm" onClick={saveNote} disabled={!note.trim()}>
            Salvar anotação
          </Button>
        </div>
      )}
      {c.summary && <p className="rounded-[14px] bg-page/70 px-3 py-2 text-[13px] text-muted">{c.summary}</p>}
      <NewTaskDialog open={task} onOpenChange={setTask} contact={{ id: c.id, name: c.name }} />
      <ForwardDialog open={forward} onOpenChange={setForward} contactId={c.id} contactName={c.name} onDone={() => mutate()} />
    </div>
  );
}

// ---------- Conversa ----------
function ConversationPane({ id, onBack, panelOpen, onTogglePanel }: { id: string; onBack: () => void; panelOpen: boolean; onTogglePanel: () => void }) {
  const me = useMe();
  const team = useTeam();
  const { mutate: gm } = useSWRConfig();
  const [older, setOlder] = useState<Msg[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const { data, error, isLoading, mutate } = useSWR<ConvDetail>(`/api/conversations/${id}`, fetcher);
  const { data: lead, mutate: mutateLead } = useSWR<LeadInfo>(data ? `/api/contacts/${data.contact.id}/lead` : null, fetcher);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [mobileLead, setMobileLead] = useState(false);
  const pendingId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const { data: saved } = useSWR<{ id: string; title: string; body: string }[]>("/api/saved-replies", fetcher);
  const refreshLists = () => gm((k) => typeof k === "string" && (k.startsWith("/api/conversations?") || k === "/api/me" || k.startsWith("/api/instagram")));

  useEffect(() => {
    setOlder([]);
    setOlderMore(null);
    setText("");
  }, [id]);
  useEffect(() => {
    if (data?.conversation.unreadCount) api.post(`/api/conversations/${id}/read`).then(refreshLists);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.conversation.unreadCount, id]);
  const msgs = useMemo(() => [...older, ...(data?.messages ?? [])], [older, data?.messages]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [data?.messages.length]);

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (isLoading || !data) return <LoadingState rows={5} className="p-6" />;
  const pending = isPending(data.conversation);

  const loadOlder = async () => {
    const first = msgs[0];
    if (!first) return;
    const r = await api.get<ConvDetail>(`/api/conversations/${id}${qs({ before: first.sentAt })}`);
    setOlder((o) => [...r.messages, ...o]);
    setOlderMore(r.hasMore);
  };
  const hasMore = olderMore ?? data.hasMore;
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    pendingId.current ??= crypto.randomUUID();
    try {
      const m = await api.post<Msg>(`/api/conversations/${id}/messages`, { text: body, clientRequestId: pendingId.current });
      pendingId.current = null;
      setText("");
      if (m.status === "failed") toast.error(m.error ?? "O Instagram recusou a mensagem.");
      else if (m.status === "unconfirmed") toast.warning("Envio não confirmado. Verifique antes de reenviar.");
      mutate();
      refreshLists();
    } catch (e) {
      const err = e as ApiError;
      if (err.code !== "network") pendingId.current = null;
      toast.error(err.message);
      mutate();
    } finally {
      setSending(false);
    }
  };
  const reconcile = async (mid: string) => {
    try {
      const r = await api.post<{ found: boolean }>(`/api/messages/${mid}/reconcile`);
      toast[r.found ? "success" : "info"](r.found ? "Mensagem confirmada no Instagram." : "Não encontrada no Instagram. Você pode reenviar com segurança.");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const resend = async (mid: string) => {
    try {
      await api.post(`/api/messages/${mid}/resend`, { clientRequestId: crypto.randomUUID() });
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const assign = async (ownerId: string) => {
    try {
      await api.patch(`/api/conversations/${id}`, { ownerId: ownerId || null });
      toast.success("Responsável atualizado.");
      mutate();
      refreshLists();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const resolve = async (resolved: boolean) => {
    try {
      await api.post(`/api/conversations/${id}/resolve`, { resolved });
      toast.success(resolved ? "Atendimento resolvido." : "Reaberto como pendente.");
      mutate();
      refreshLists();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const createLead = async () => {
    try {
      mutateLead(await api.post<LeadInfo>(`/api/contacts/${data.contact.id}/lead`, { from: "direct" }), { revalidate: false });
      toast.success("Lead criado no funil do Social Seller.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-4">
        <span className="lg:hidden">
          <IconButton label="Voltar para a lista" size="sm" onClick={onBack}>
            <ArrowLeft className="size-5" />
          </IconButton>
        </span>
        <div className="relative shrink-0">
          <Avatar name={data.contact.name} src={data.contact.avatarUrl} size={42} />
          <ChannelBadge />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-semibold leading-tight">{data.contact.name}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {data.contact.username && <span className="truncate text-[12.5px] text-muted">@{data.contact.username}</span>}
            {lead &&
              (lead.isLead ? (
                <button onClick={() => (window.innerWidth >= 1536 ? !panelOpen && onTogglePanel() : setMobileLead(true))} className="inline-flex items-center gap-1 rounded-full bg-selected px-2 py-0.5 text-[11.5px] font-semibold text-brand-dark hover:brightness-95">
                  <UserRoundCheck className="size-3" aria-hidden /> Lead no CRM
                </button>
              ) : (
                <button onClick={createLead} className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand px-2 py-0.5 text-[11.5px] font-semibold text-brand hover:bg-selected">
                  <Plus className="size-3" aria-hidden /> Criar Lead
                </button>
              ))}
          </div>
        </div>
        {pending ? (
          <span className="hidden sm:block">
            <Button size="sm" variant="secondary" icon={<CircleCheck className="size-4" />} onClick={() => resolve(true)}>
              Resolver
            </Button>
          </span>
        ) : (
          <span className="hidden items-center gap-1 text-[12.5px] font-medium text-success sm:inline-flex">
            <CheckCheck className="size-4" aria-hidden /> Respondida
          </span>
        )}
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Mais ações" size="sm">
              <UserRound className="size-[18px]" />
            </IconButton>
          </MenuTrigger>
          <MenuContent>
            <MenuLabel>Responsável: {data.conversation.owner?.name ?? "ninguém"}</MenuLabel>
            {team
              .filter((m) => m.status === "active" && (me.permissions.assign || m.userId === me.user.id))
              .map((m) => (
                <MenuItem key={m.userId} disabled={m.userId === data.conversation.ownerId} onSelect={() => assign(m.userId)}>
                  {m.userId === me.user.id ? `Assumir (${m.name})` : m.name}
                </MenuItem>
              ))}
            {me.permissions.assign && data.conversation.ownerId && <MenuItem onSelect={() => assign("")}>Sem responsável</MenuItem>}
            <MenuSeparator />
            {pending ? (
              <MenuItem icon={<CircleCheck />} onSelect={() => resolve(true)}>
                Marcar como resolvida
              </MenuItem>
            ) : (
              <MenuItem icon={<RotateCcw />} onSelect={() => resolve(false)}>
                Reabrir como pendente
              </MenuItem>
            )}
          </MenuContent>
        </Menu>
        <span className="hidden 2xl:block">
          <IconButton label={panelOpen ? "Esconder informações do lead" : "Mostrar informações do lead"} size="sm" onClick={onTogglePanel}>
            {panelOpen ? <PanelRightClose className="size-[18px]" /> : <PanelRightOpen className="size-[18px]" />}
          </IconButton>
        </span>
        <span className="2xl:hidden">
          <IconButton label="Informações do lead" size="sm" onClick={() => setMobileLead(true)}>
            <PanelRightOpen className="size-[18px]" />
          </IconButton>
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin bg-[#f7faf9] px-3 py-4 sm:px-5" aria-live="polite">
        {hasMore ? (
          <div className="mb-4 flex justify-center">
            <Button variant="secondary" size="sm" onClick={loadOlder}>
              Carregar mensagens anteriores
            </Button>
          </div>
        ) : (
          data.historyNote && <p className="mx-auto mb-4 max-w-md rounded-[12px] bg-white px-3 py-2 text-center text-[12px] text-muted">{data.historyNote}</p>
        )}
        <ol className="flex flex-col gap-2">
          {msgs.map((m, i) => {
            const prev = msgs[i - 1];
            const newDay = !prev || new Date(prev.sentAt).toDateString() !== new Date(m.sentAt).toDateString();
            return (
              <Fragment key={m.id}>
                {newDay && <li className="my-2 self-center rounded-full bg-white px-3 py-1 text-[11.5px] text-muted shadow-sm">{dayLabel(m.sentAt).split(",")[0]}</li>}
                <li className={cx("anim-fade flex max-w-[82%] flex-col sm:max-w-[72%]", m.direction === "out" ? "self-end items-end" : "self-start items-start")}>
                  <div className={cx("rounded-[18px] px-3.5 py-2.5 text-[14.5px]", m.direction === "out" ? "rounded-br-[6px] bg-brand text-white" : "rounded-bl-[6px] border border-line bg-white", m.status === "failed" && "opacity-70")}>
                    <MessageContent m={m} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 px-1">
                    <span className="text-[11px] text-muted" title={formatDateTime(m.sentAt)}>
                      {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit" }).format(new Date(m.sentAt))}
                      {m.direction === "out" && (m.sentByName ? ` · ${m.sentByName.split(" ")[0]} via @${data.conversation.accountUsername ?? "conta"}` : ` · @${data.conversation.accountUsername ?? "conta"}`)}
                    </span>
                    <MessageStatus m={m} onReconcile={() => reconcile(m.id)} onResend={() => resend(m.id)} />
                  </div>
                </li>
              </Fragment>
            );
          })}
        </ol>
        {msgs.length === 0 && <EmptyState title="Sem mensagens" description="As mensagens recebidas pela conta conectada aparecerão aqui." />}
        <div ref={bottom} />
      </div>
      <footer className="border-t border-line bg-white p-3">
        {!data.send.allowed ? (
          <div role="status" className="flex items-start gap-2.5 rounded-[14px] bg-warning-soft px-4 py-3 text-[13px] text-[#6b4a00]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{data.send.reason}</span>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            {data.send.humanAgent && <p className="mb-1.5 text-[12px] text-warning">Fora das 24 h: vai com a tag de atendimento humano (até {dayLabel(data.send.windowEndsAt)}).</p>}
            <div className="flex items-end gap-2 rounded-[18px] border border-line bg-white p-1.5 focus-within:border-brand">
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label="Respostas salvas" size="sm" disabled={!saved?.length}>
                    <MessageSquareQuote className="size-[18px]" />
                  </IconButton>
                </MenuTrigger>
                <MenuContent align="start">
                  <MenuLabel>Respostas salvas</MenuLabel>
                  {saved?.map((r) => (
                    <MenuItem key={r.id} onSelect={() => setText((t) => (t ? `${t}\n${r.body}` : r.body))}>
                      {r.title}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
              <textarea
                aria-label="Mensagem"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  pendingId.current = null;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                maxLength={1000}
                rows={1}
                placeholder={`Digite uma mensagem como @${data.conversation.accountUsername ?? "conta"}…`}
                className="max-h-36 min-h-[36px] flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] outline-none placeholder:text-[#8a99a3]"
              />
              <button type="submit" disabled={!text.trim() || sending} aria-label="Enviar" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-white transition-opacity disabled:opacity-40">
                <Send className="size-[18px]" aria-hidden />
              </button>
            </div>
            <p className="mt-1 px-1 text-right text-[11px] text-muted">
              Pode responder até {dayLabel(data.send.windowEndsAt)} · {text.length}/1000
            </p>
          </form>
        )}
      </footer>
      <Sheet open={mobileLead} onOpenChange={setMobileLead} title="Informações do lead" width={420}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="font-semibold">Lead</p>
          <IconButton label="Fechar" size="sm" onClick={() => setMobileLead(false)}>
            <ArrowLeft className="size-4" />
          </IconButton>
        </div>
        <div className="overflow-y-auto">{mobileLead && <LeadPanel contactId={data.contact.id} compact />}</div>
      </Sheet>
    </div>
  );
}

// ---------- Caixa de entrada ----------
export function ConversationsView({ embedded }: { channel?: "instagram"; embedded?: boolean }) {
  const me = useMe();
  const [selected, setSelected] = useQueryParam("c", "");
  const [filter, setFilter] = useQueryParam("filtro", "pending");
  const [owner, setOwner] = useQueryParam("dono", "all");
  const [panelOpen, setPanelOpen] = useState(true);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const realFilter = filter === "pending" ? "pending" : "all";
  const getKey = (i: number, prev: ConvList | null) => {
    if (prev && !prev.nextCursor) return null;
    return `/api/conversations${qs({ filter: realFilter, owner: owner === "all" ? "" : owner, channel: "instagram", q: debounced, cursor: i === 0 ? undefined : prev?.nextCursor })}`;
  };
  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite<ConvList>(getKey, fetcher, { revalidateFirstPage: true, keepPreviousData: true });
  const rows = data?.flatMap((p) => p.rows) ?? [];
  const hasNext = !!data?.[data.length - 1]?.nextCursor;
  const pendingTotal = me.counts.pendingDirects ?? 0;
  const selectedRow = rows.find((r) => r.id === selected);

  return (
    <div className={cx("grid overflow-hidden rounded-[24px] border border-line bg-white shadow-[var(--shadow-soft)] lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]", panelOpen && "2xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)_320px]", embedded ? "h-[calc(100dvh-300px)] min-h-[520px]" : "h-[calc(100dvh-250px)] min-h-[540px]")}>
      <aside className={cx("flex min-h-0 flex-col border-r border-line", selected && "hidden lg:flex")}>
        <div className="flex flex-col gap-3 border-b border-line px-4 pb-3 pt-4">
          <p className="text-[14px]">
            <b className="text-[16px] font-bold text-ink">{pendingTotal}</b> <span className="text-muted">conversa{pendingTotal === 1 ? "" : "s"} esperando resposta</span>
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Pesquisar nome, @ ou mensagem" aria-label="Pesquisar conversas" className="h-11 w-full rounded-[14px] border border-line bg-page/60 pl-11 pr-3 text-[14px] focus:border-brand focus:bg-white focus:outline-none" />
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-[12px] bg-page p-1" role="tablist" aria-label="Filtro">
              {(
                [
                  ["pending", "Sem resposta"],
                  ["all", "Todas"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} role="tab" aria-selected={realFilter === v} onClick={() => setFilter(v)} className={cx("whitespace-nowrap rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-colors", realFilter === v ? "bg-white text-brand shadow-sm" : "text-muted hover:text-ink")}>
                  {l}
                </button>
              ))}
            </div>
            <select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="ml-auto h-9 min-w-0 max-w-[140px] rounded-[10px] border border-line bg-white px-2 text-[12.5px] text-muted focus:border-brand focus:outline-none">
              <option value="all">Todos</option>
              <option value="mine">Minhas</option>
              <option value="none">Sem responsável</option>
            </select>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          {error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : isLoading && !data ? (
            <LoadingState rows={6} className="p-4" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={realFilter === "pending" && !debounced ? <CheckCheck /> : <Inbox />}
              title={realFilter === "pending" && !debounced ? "Tudo respondido" : "Nenhuma conversa"}
              description={realFilter === "pending" && !debounced ? "Nenhum Direct esperando resposta agora." : debounced ? "Nada encontrado com esta pesquisa." : "Quando alguém enviar mensagem para a conta conectada, a conversa aparece aqui."}
            />
          ) : (
            <ul>
              {rows.map((c, i) => {
                const p = isPending(c);
                return (
                  <li key={c.id} className="anim-fade" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
                    <button onClick={() => setSelected(c.id)} aria-current={selected === c.id ? "true" : undefined} className={cx("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-page", selected === c.id && "bg-selected/70")}>
                      <span className="relative shrink-0">
                        <Avatar name={c.contactName} src={c.avatarUrl} size={48} />
                        <ChannelBadge />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className={cx("truncate text-[14.5px]", p ? "font-semibold text-ink" : "font-medium text-ink/90")}>{c.contactName}</span>
                          <span className="ml-auto shrink-0 text-[11.5px] text-muted">{shortAgo(c.lastMessageAt)}</span>
                        </span>
                        <span className="mt-0.5 flex items-center gap-2">
                          <span className={cx("truncate text-[13px]", p ? "text-ink" : "text-muted")}>
                            {c.matchedText && debounced ? `“${c.matchedText.slice(0, 60)}”` : `${c.lastMessageDirection === "out" ? "Você: " : ""}${c.lastMessagePreview ?? "Sem mensagens"}`}
                          </span>
                          {p && c.pendingCount > 0 && <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{c.pendingCount}</span>}
                        </span>
                        {c.ownerName && <span className="mt-0.5 block truncate text-[11.5px] text-muted">{c.ownerName}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
              {hasNext && (
                <li className="p-3">
                  <Button variant="secondary" size="sm" className="w-full" onClick={() => setSize(size + 1)}>
                    Carregar mais
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
      </aside>
      <section className={cx("min-h-0 min-w-0", !selected && "hidden lg:block")}>
        {selected ? (
          <ConversationPane id={selected} onBack={() => setSelected("")} panelOpen={panelOpen} onTogglePanel={() => setPanelOpen((v) => !v)} />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState icon={<InstagramGlyph size={28} />} title="Selecione uma conversa" description="Leia e responda os Directs sem sair do CRMLABS — com o contexto comercial ao lado." />
          </div>
        )}
      </section>
      {panelOpen && <aside className="hidden min-h-0 overflow-y-auto scroll-thin border-l border-line 2xl:block">{selected && (selectedRow?.contactId || selected) ? <LeadPanelForConversation conversationId={selected} /> : <p className="p-5 text-[13px] text-muted">As informações do lead aparecem aqui.</p>}</aside>}
    </div>
  );
}

function LeadPanelForConversation({ conversationId }: { conversationId: string }) {
  const { data } = useSWR<ConvDetail>(`/api/conversations/${conversationId}`, fetcher);
  if (!data) return <LoadingState rows={3} className="p-5" />;
  return <LeadPanel contactId={data.contact.id} />;
}
