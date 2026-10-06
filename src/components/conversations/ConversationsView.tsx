"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CircleAlert,
  CircleCheck,
  Clock,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Inbox,
  Info,
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
import { Avatar, Button, cx, EmptyState, ErrorState, IconButton, LoadingState, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Sheet, Spinner, StageChip, Textarea } from "@/components/ui";
import { ChannelBadge, InstagramGlyph } from "@/components/ui/ChannelIcon";
import { NewTaskDialog } from "@/components/tasks/TaskParts";
import { ForwardDialog } from "@/components/commercial/ForwardDialog";
import { TransformLeadDialog } from "@/components/instagram/TransformLeadDialog";
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
  isLead: boolean;
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
  /** Cartão que entrou sozinho no Kanban pela regra antiga (aguarda revisão; não é Lead). */
  autoEntry: boolean;
  /** Mesma pessoa já é Lead em outro contato (mesmo @). */
  duplicateOf: { id: string; name: string } | null;
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

/** Story respondido/mencionado: a API entrega um link temporário da mídia (some quando o story expira). */
function StoryCard({ url, label, out }: { url?: string; label: string; out: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={cx("mb-1.5 flex items-center gap-2.5 rounded-[12px] p-1.5 pr-3", out ? "bg-white/15" : "bg-page")}>
      {url && !broken ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="block h-16 w-10 shrink-0 overflow-hidden rounded-[8px] bg-black/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Story" className="size-full object-cover" loading="lazy" onError={() => setBroken(true)} />
        </a>
      ) : (
        <span className={cx("flex h-16 w-10 shrink-0 items-center justify-center rounded-[8px]", out ? "bg-white/20" : "bg-white")} aria-hidden>
          <Sparkles className="size-4 opacity-70" />
        </span>
      )}
      <span className={cx("text-[12px] font-medium leading-snug", out ? "text-white" : "text-muted")}>
        {label}
        {(broken || !url) && <span className="block font-normal opacity-80">Story indisponível (expira em 24 h)</span>}
      </span>
    </div>
  );
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
      {storyReply && <StoryCard url={storyReply.url} label={out ? "Você respondeu ao story" : "Respondeu ao seu story"} out={out} />}
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
            <StoryCard key={i} url={a.url} label="Mencionou você no story" out={out} />
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
  const [transform, setTransform] = useState(false);
  if (!data) return <LoadingState rows={3} className="p-5" />;
  const c = data.contact;
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
          <p className="font-semibold text-ink">Não está no CRM</p>
          {data.duplicateOf ? (
            <>
              <p className="mt-1">Este contato já é um Lead ({data.duplicateOf.name}).</p>
              <Button className="mt-3 w-full" variant="secondary" icon={<UserRoundCheck className="size-4" />} onClick={() => openContact(data.duplicateOf!.id)}>
                Ver Lead
              </Button>
            </>
          ) : (
            <>
              <p className="mt-1">Contato do Instagram. Só entra no Kanban do Social Seller quando alguém da equipe transformar em Lead.</p>
              {data.autoEntry && <p className="mt-2 rounded-[10px] bg-warning-soft px-2.5 py-1.5 text-[12px] text-[#6b4a00]">Entrou sozinho no Kanban pela regra antiga. Confirme transformando em Lead ou peça ao administrador para revisar.</p>}
              <Button className="mt-3 w-full" icon={<Plus className="size-4" />} onClick={() => setTransform(true)}>
                Transformar em Lead
              </Button>
            </>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="secondary" icon={<UserRound className="size-4" />} onClick={() => openContact(c.id)}>
          {data.isLead ? "Ver Lead" : "Ver contato"}
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
      <TransformLeadDialog open={transform} onOpenChange={setTransform} contact={c} from="direct" onDone={() => { mutate(); gm((k) => typeof k === "string" && k.startsWith("/api/board")); }} />
    </div>
  );
}

/** Faixa abaixo do cabeçalho da conversa: é Lead (etapa, responsável) ou ainda não está no CRM. */
function CrmStatusBar({ lead, onTransform }: { lead: LeadInfo; onTransform: () => void }) {
  const openContact = useOpenContact();
  const stage = lead.opportunity?.status === "open" ? `${lead.opportunity.stageName} (Comercial)` : lead.stage?.name;
  const owner = lead.ownerName ?? lead.opportunity?.closerName;
  const link = (id: string) => (
    <button onClick={() => openContact(id)} className="ml-auto shrink-0 font-semibold text-brand hover:underline">
      Ver Lead
    </button>
  );
  return (
    <div className="flex min-w-0 items-center gap-2 border-b border-line bg-page/50 px-3 py-2 text-[12.5px] sm:px-4">
      {lead.isLead ? (
        <>
          <UserRoundCheck className="size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 truncate">
            <b className="font-semibold text-brand-dark">Lead no CRM</b>
            {stage && <span className="text-muted"> · Etapa: <span className="text-ink">{stage}</span></span>}
            {owner && <span className="text-muted"> · Responsável: <span className="text-ink">{owner}</span></span>}
          </span>
          {link(lead.contact.id)}
        </>
      ) : lead.duplicateOf ? (
        <>
          <UserRoundCheck className="size-4 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 truncate text-muted">Este contato já é um Lead ({lead.duplicateOf.name}).</span>
          {link(lead.duplicateOf.id)}
        </>
      ) : (
        <>
          <span className="size-2 shrink-0 rounded-full bg-[#b9c6cc]" aria-hidden />
          <span className="min-w-0 truncate text-muted">Não está no CRM</span>
          <button onClick={onTransform} className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-brand px-2.5 py-1 text-[12px] font-semibold text-brand hover:bg-selected">
            <Plus className="size-3.5" aria-hidden /> Transformar em Lead
          </button>
        </>
      )}
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
  const [transform, setTransform] = useState(false);
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
          {data.contact.username && <p className="mt-0.5 truncate text-[12.5px] text-muted">@{data.contact.username}</p>}
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
      {lead && <CrmStatusBar lead={lead} onTransform={() => setTransform(true)} />}
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
      <TransformLeadDialog open={transform} onOpenChange={setTransform} contact={data.contact} from="direct" onDone={() => mutateLead()} />
    </div>
  );
}

// ---------- Caixa de entrada ----------
type InboxSummary = { directSync: { done: boolean; conversations: number; pages: number } | null };

const FILTERS = [
  ["pending", "Sem resposta"],
  ["all", "Todas"],
  ["stories", "Stories"],
] as const;

export function ConversationsView({ embedded }: { channel?: "instagram"; embedded?: boolean }) {
  const me = useMe();
  const [selected, setSelected] = useQueryParam("c", "");
  const [filter, setFilter] = useQueryParam("filtro", "pending");
  const [owner, setOwner] = useQueryParam("dono", "all");
  const [panelOpen, setPanelOpen] = useState(true);
  const [folderInfo, setFolderInfo] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const realFilter = FILTERS.some(([v]) => v === filter) ? (filter as (typeof FILTERS)[number][0]) : "pending";
  // Pesquisa vale para todas as conversas sincronizadas (não só a aba atual).
  const effectiveFilter = debounced ? "all" : realFilter;
  const getKey = (i: number, prev: ConvList | null) => {
    if (prev && !prev.nextCursor) return null;
    return `/api/conversations${qs({ filter: effectiveFilter, owner: owner === "all" ? "" : owner, channel: "instagram", q: debounced, cursor: i === 0 ? undefined : prev?.nextCursor })}`;
  };
  const { data, error, isLoading, isValidating, size, setSize, mutate } = useSWRInfinite<ConvList>(getKey, fetcher, { revalidateFirstPage: true, keepPreviousData: true });
  const { data: summary } = useSWR<InboxSummary>("/api/instagram", fetcher, { refreshInterval: 60_000 });
  const syncing = summary?.directSync && !summary.directSync.done ? summary.directSync : null;
  const rows = data?.flatMap((p) => p.rows) ?? [];
  const hasNext = !!data?.[data.length - 1]?.nextCursor;
  const pendingTotal = me.counts.pendingDirects ?? 0;
  const selectedRow = rows.find((r) => r.id === selected);
  const searching = !!q.trim() && (q.trim() !== debounced || (isValidating && size <= 1));
  const loadingMore = isValidating && size > 1 && data?.length !== size;

  // Rolagem infinita: carrega a próxima página quando o fim da lista aparece.
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLLIElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNext) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !loadingMore) setSize((n) => n + 1);
    }, { root: scroller.current, rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNext, loadingMore, setSize, rows.length]);

  return (
    <div className={cx("grid overflow-hidden rounded-[24px] border border-line bg-white shadow-[var(--shadow-soft)] lg:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]", panelOpen && "2xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)_320px]", embedded ? "h-[calc(100dvh-300px)] min-h-[520px]" : "h-[calc(100dvh-250px)] min-h-[540px]")}>
      <aside className={cx("flex min-h-0 flex-col border-r border-line", selected && "hidden lg:flex")}>
        <div className="flex flex-col gap-3 border-b border-line px-4 pb-3 pt-4">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 text-[14px]">
              <b className="text-[16px] font-bold text-ink">{pendingTotal}</b> <span className="text-muted">esperando resposta</span>
            </p>
            <select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="h-9 shrink-0 rounded-[10px] border border-line bg-white px-2 text-[12.5px] text-muted focus:border-brand focus:outline-none">
              <option value="all">Todos</option>
              <option value="mine">Minhas</option>
              <option value="none">Sem responsável</option>
            </select>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Buscar nome, @ ou mensagem" aria-label="Pesquisar conversas" className="h-11 w-full rounded-[14px] border border-line bg-page/60 pl-11 pr-10 text-[14px] focus:border-brand focus:bg-white focus:outline-none" />
            {searching && <Spinner className="absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-brand" />}
          </div>
          <div className="flex items-center gap-2">
            <div className={cx("inline-flex rounded-[12px] bg-page p-1", debounced && "opacity-50")} role="tablist" aria-label="Atendimento">
              {FILTERS.map(([v, l]) => (
                <button key={v} role="tab" aria-selected={realFilter === v} onClick={() => setFilter(v)} className={cx("whitespace-nowrap rounded-[9px] px-2.5 py-1.5 text-[13px] font-medium transition-colors", realFilter === v ? "bg-white text-brand shadow-sm" : "text-muted hover:text-ink")}>
                  {l}
                </button>
              ))}
            </div>
            <button onClick={() => setFolderInfo((v) => !v)} aria-expanded={folderInfo} aria-label="Por que não há Principal, Geral e Pedidos?" title="Principal, Geral e Pedidos" className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink">
              <Info className="size-4" aria-hidden />
            </button>
          </div>
          {folderInfo && (
            <p className="rounded-[12px] bg-page px-3 py-2.5 text-[12.5px] leading-relaxed text-muted">
              <b className="font-semibold text-ink">Principal, Geral e Pedidos:</b> a API oficial do Instagram não informa em qual pasta cada conversa está, então todas as conversas que ela entrega aparecem juntas aqui. Pedidos ocultos não estão disponíveis através da API utilizada.
            </p>
          )}
          {debounced && <p className="text-[12px] text-muted">Pesquisando em todas as conversas sincronizadas.</p>}
        </div>
        {syncing && (
          <div role="status" className="flex items-center gap-2 border-b border-line bg-info-soft/60 px-4 py-2 text-[12.5px] text-info">
            <Spinner className="size-3.5" />
            <span>
              Sincronizando conversas… <b className="font-semibold">{syncing.conversations}</b> importadas. As mais antigas continuam chegando em segundo plano.
            </span>
          </div>
        )}
        <div ref={scroller} className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          {error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : (isLoading && !data) || (searching && rows.length === 0) ? (
            <div>
              {searching && <p className="px-4 pt-3 text-[13px] text-muted">Pesquisando…</p>}
              <LoadingState rows={6} className="p-4" />
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={realFilter === "pending" && !debounced ? <CheckCheck /> : <Inbox />}
              title={debounced ? "Nenhuma conversa encontrada" : realFilter === "pending" ? "Tudo respondido" : realFilter === "stories" ? "Nenhuma interação com Stories" : "Nenhuma conversa"}
              description={
                debounced
                  ? syncing
                    ? "Ainda estamos importando conversas antigas. Tente de novo em alguns minutos."
                    : "Confira o nome, o @ ou o trecho da mensagem."
                  : realFilter === "pending"
                    ? "Nenhum Direct esperando resposta agora."
                    : realFilter === "stories"
                      ? "Respostas aos seus stories e menções em stories aparecem aqui."
                      : "Quando alguém enviar mensagem para a conta conectada, a conversa aparece aqui."
              }
            />
          ) : (
            <ul className={cx(searching && "opacity-60 transition-opacity")}>
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
                        {(c.ownerName || c.isLead) && (
                          <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] text-muted">
                            {c.isLead && <span className="rounded-full bg-selected px-1.5 py-px text-[10.5px] font-semibold text-brand-dark">Lead</span>}
                            {c.ownerName && <span className="truncate">{c.ownerName}</span>}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
              {hasNext && (
                <li ref={sentinel} className="flex items-center justify-center gap-2 p-4 text-[12.5px] text-muted">
                  <Spinner className="size-4" /> Carregando mais conversas…
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
