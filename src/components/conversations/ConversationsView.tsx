"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import { ArrowLeft, Check, CheckCheck, CircleAlert, Clock, Inbox, MessageSquareQuote, Search, Send, ShieldAlert, UserRound } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import { dayLabel, formatDateTime, relativeTime } from "@/lib/format";
import { Avatar, Badge, Button, cx, EmptyState, ErrorState, IconButton, LoadingState, Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger, Select, StageChip, Textarea } from "@/components/ui";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";

type ConvRow = {
  id: string;
  channel: string;
  status: string;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "in" | "out" | null;
  ownerId: string | null;
  ownerName: string | null;
  contactId: string;
  contactName: string;
  contactUsername: string | null;
  avatarUrl: string | null;
  accountUsername: string | null;
};
type ConvList = { rows: ConvRow[]; nextCursor: string | null };
type Msg = { id: string; direction: "in" | "out"; body: string | null; attachments: { type: string; url?: string }[] | null; status: string; error: string | null; sentAt: string; sentByName: string | null };
type ConvDetail = {
  conversation: { id: string; ownerId: string | null; owner: { id: string; name: string } | null; accountUsername: string | null; unreadCount: number; status: string; contactId: string };
  contact: { id: string; name: string; username: string | null; avatarUrl: string | null };
  messages: Msg[];
  hasMore: boolean;
  historyNote: string | null;
  send: { allowed: true; humanAgent: boolean; windowEndsAt: string } | { allowed: false; reason: string; code: string };
};

const FILTERS = [
  { value: "all", label: "Todas" },
  { value: "mine", label: "Minhas" },
  { value: "unread", label: "Não lidas" },
  { value: "awaiting", label: "Aguardando resposta" },
] as const;

function MessageStatus({ m, onReconcile, onResend }: { m: Msg; onReconcile: () => void; onResend: () => void }) {
  if (m.direction === "in") return null;
  switch (m.status) {
    case "pending":
      return (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
          <Clock className="size-3.5" aria-hidden /> Enviando…
        </span>
      );
    case "accepted":
      return (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-muted" title="O Instagram aceitou a mensagem. Confirmação de entrega não é fornecida pela API.">
          <Check className="size-3.5" aria-hidden /> Aceita pelo Instagram
        </span>
      );
    case "delivered":
      return (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-muted">
          <CheckCheck className="size-3.5" aria-hidden /> Entregue
        </span>
      );
    case "read":
      return (
        <span className="inline-flex items-center gap-1 text-[11.5px] text-info">
          <CheckCheck className="size-3.5" aria-hidden /> Lida (confirmado pelo Instagram)
        </span>
      );
    case "unconfirmed":
      return (
        <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-warning">
          <CircleAlert className="size-3.5" aria-hidden /> {m.error ?? "Envio não confirmado."}
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
        <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-danger">
          <CircleAlert className="size-3.5" aria-hidden /> {m.error ?? "Falhou."}
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

function ConversationPane({ id, onBack }: { id: string; onBack: () => void }) {
  const me = useMe();
  const team = useTeam();
  const openContact = useOpenContact();
  const { mutate: gm } = useSWRConfig();
  const [older, setOlder] = useState<Msg[]>([]);
  const [olderMore, setOlderMore] = useState<boolean | null>(null);
  const { data, error, isLoading, mutate } = useSWR<ConvDetail>(`/api/conversations/${id}`, fetcher);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const pendingId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const { data: saved } = useSWR<{ id: string; title: string; body: string }[]>("/api/saved-replies", fetcher);

  useEffect(() => {
    setOlder([]);
    setOlderMore(null);
    setText("");
  }, [id]);

  useEffect(() => {
    if (data?.conversation.unreadCount) {
      api.post(`/api/conversations/${id}/read`).then(() => gm((k) => typeof k === "string" && (k.startsWith("/api/conversations?") || k === "/api/me")));
    }
  }, [data?.conversation.unreadCount, id, gm]);

  const msgs = useMemo(() => [...older, ...(data?.messages ?? [])], [older, data?.messages]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [data?.messages.length]);

  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (isLoading || !data) return <LoadingState rows={5} className="p-6" />;

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
    // Um id por tentativa: cliques repetidos ou retries de rede não duplicam a mensagem.
    pendingId.current ??= crypto.randomUUID();
    try {
      const m = await api.post<Msg>(`/api/conversations/${id}/messages`, { text: body, clientRequestId: pendingId.current });
      pendingId.current = null;
      setText("");
      if (m.status === "failed") toast.error(m.error ?? "O Instagram recusou a mensagem.");
      else if (m.status === "unconfirmed") toast.warning("Envio não confirmado. Verifique antes de reenviar.");
      mutate();
      gm((k) => typeof k === "string" && k.startsWith("/api/conversations?"));
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
      gm((k) => typeof k === "string" && k.startsWith("/api/conversations?"));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <IconButton label="Voltar para a lista" onClick={onBack} className="lg:hidden">
          <ArrowLeft className="size-5" />
        </IconButton>
        <Avatar name={data.contact.name} src={data.contact.avatarUrl} size={42} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-semibold">{data.contact.name}</p>
          <p className="flex items-center gap-1.5 truncate text-[12.5px] text-muted">
            <InstagramGlyph size={14} />
            {data.contact.username ? `@${data.contact.username}` : "Instagram"}
            {data.conversation.accountUsername && <> · via @{data.conversation.accountUsername}</>}
          </p>
        </div>
        <Select aria-label="Responsável pela conversa" value={data.conversation.ownerId ?? ""} onChange={(e) => assign(e.target.value)} className="hidden sm:block w-auto max-w-[180px] h-10 text-[13.5px]" disabled={!me.permissions.assign && data.conversation.ownerId !== null && data.conversation.ownerId !== me.user.id}>
          <option value="">Sem responsável</option>
          {team
            .filter((m) => m.status === "active")
            .map((m) => (
              <option key={m.userId} value={m.userId} disabled={!me.permissions.assign && m.userId !== me.user.id}>
                {m.name}
              </option>
            ))}
        </Select>
        <Button variant="secondary" size="sm" onClick={() => openContact(data.contact.id)} icon={<UserRound className="size-4" />} className="xl:hidden">
          Dados
        </Button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin bg-[#f7faf9] px-4 py-4" aria-live="polite">
        {hasMore ? (
          <div className="mb-4 flex justify-center">
            <Button variant="secondary" size="sm" onClick={loadOlder}>
              Carregar mensagens anteriores
            </Button>
          </div>
        ) : (
          data.historyNote && <p className="mx-auto mb-4 max-w-md rounded-[12px] bg-white px-3 py-2 text-center text-[12px] text-muted">{data.historyNote}</p>
        )}
        <ol className="flex flex-col gap-2.5">
          {msgs.map((m) => (
            <li key={m.id} className={cx("flex flex-col max-w-[78%]", m.direction === "out" ? "self-end items-end" : "self-start items-start")}>
              <div className={cx("rounded-[18px] px-3.5 py-2.5 text-[14.5px] whitespace-pre-wrap break-words", m.direction === "out" ? "bg-brand text-white rounded-br-[6px]" : "bg-white border border-line rounded-bl-[6px]", m.status === "failed" && "opacity-70")}>
                {m.body ?? (m.error ? <em className="opacity-75">{m.error}</em> : null)}
                {m.attachments?.map((a, i) => (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 block text-[13px] underline">
                    Anexo: {a.type}
                  </a>
                ))}
              </div>
              <div className="mt-1 flex items-center gap-2 px-1">
                <span className="text-[11.5px] text-muted" title={formatDateTime(m.sentAt)}>
                  {dayLabel(m.sentAt)}
                  {m.direction === "out" && m.sentByName ? ` · ${m.sentByName}` : ""}
                </span>
                <MessageStatus m={m} onReconcile={() => reconcile(m.id)} onResend={() => resend(m.id)} />
              </div>
            </li>
          ))}
        </ol>
        {msgs.length === 0 && <EmptyState title="Sem mensagens" description="As mensagens recebidas pela conta conectada aparecerão aqui." />}
        <div ref={bottom} />
      </div>
      <footer className="border-t border-line bg-white p-3">
        {!data.send.allowed ? (
          <div role="status" className="flex items-start gap-2.5 rounded-[14px] bg-warning-soft px-4 py-3 text-[13.5px] text-[#6b4a00]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{data.send.reason}</span>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex flex-col gap-2"
          >
            {data.send.humanAgent && <p className="text-[12px] text-warning">Fora das 24 h: a resposta será enviada com a tag de atendimento humano (até {dayLabel(data.send.windowEndsAt)}).</p>}
            <div className="flex items-end gap-2">
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label="Respostas salvas" disabled={!saved?.length}>
                    <MessageSquareQuote className="size-5" />
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
              <Textarea
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
                placeholder="Escreva uma resposta… (Enter envia, Shift+Enter quebra linha)"
                className="min-h-[48px] max-h-40 flex-1"
                rows={1}
              />
              <Button type="submit" loading={sending} disabled={!text.trim()} icon={<Send className="size-4" />} className="h-12">
                Enviar
              </Button>
            </div>
            <p className="text-right text-[11.5px] text-muted">
              Janela de resposta até {dayLabel(data.send.windowEndsAt)} · {text.length}/1000
            </p>
          </form>
        )}
      </footer>
    </div>
  );
}

type ContactMini = {
  contact: { id: string; name: string; username: string | null; avatarUrl: string | null; nextAction: string | null; nextActionAt: string | null; owner: { name: string } | null; summary: string | null };
  entry: { stageName: string; stageColor: string } | null;
  tags: { id: string; name: string }[];
};

function ContactSidePane({ conversationId }: { conversationId: string }) {
  const { data: conv } = useSWR<ConvDetail>(`/api/conversations/${conversationId}`, fetcher);
  const { data } = useSWR<ContactMini>(conv ? `/api/contacts/${conv.contact.id}` : null, fetcher);
  const openContact = useOpenContact();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  if (!data) return <LoadingState rows={3} className="p-5" />;
  const addNote = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await api.post(`/api/contacts/${data.contact.id}/notes`, { body: note });
      setNote("");
      toast.success("Nota interna salva.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-5 p-5">
      <div className="flex flex-col items-center text-center">
        <Avatar name={data.contact.name} src={data.contact.avatarUrl} size={64} />
        <p className="mt-2 text-[16px] font-semibold">{data.contact.name}</p>
        {data.contact.username && <p className="text-[13px] text-muted">@{data.contact.username}</p>}
        {data.entry && (
          <div className="mt-2">
            <StageChip name={data.entry.stageName} color={data.entry.stageColor} />
          </div>
        )}
      </div>
      <dl className="flex flex-col gap-3 text-[13.5px]">
        <div>
          <dt className="text-muted">Responsável</dt>
          <dd className="font-medium">{data.contact.owner?.name ?? "Sem responsável"}</dd>
        </div>
        <div>
          <dt className="text-muted">Próxima ação</dt>
          <dd className="font-medium">{data.contact.nextAction ? `${data.contact.nextAction}${data.contact.nextActionAt ? ` · ${dayLabel(data.contact.nextActionAt)}` : ""}` : "—"}</dd>
        </div>
        {data.contact.summary && (
          <div>
            <dt className="text-muted">Resumo</dt>
            <dd>{data.contact.summary}</dd>
          </div>
        )}
        {data.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {data.tags.map((t) => (
              <Badge key={t.id}>{t.name}</Badge>
            ))}
          </div>
        )}
      </dl>
      <Button variant="soft" onClick={() => openContact(data.contact.id)}>
        Abrir contato completo
      </Button>
      <div className="flex flex-col gap-2">
        <label htmlFor="side-note" className="text-[13.5px] font-medium">
          Nota interna
        </label>
        <Textarea id="side-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visível só para a equipe" className="min-h-[72px]" />
        <p className="text-[11.5px] text-muted">Nunca é enviada ao Instagram.</p>
        <Button size="sm" variant="secondary" loading={saving} disabled={!note.trim()} onClick={addNote}>
          Salvar nota
        </Button>
      </div>
    </div>
  );
}

export function ConversationsView({ channel, embedded }: { channel?: "instagram"; embedded?: boolean }) {
  const [selected, setSelected] = useQueryParam("c", "");
  const [filter, setFilter] = useQueryParam("filtro", "all");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const getKey = (i: number, prev: ConvList | null) => {
    if (prev && !prev.nextCursor) return null;
    return `/api/conversations${qs({ filter, channel, q: debounced, cursor: i === 0 ? undefined : prev?.nextCursor })}`;
  };
  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite<ConvList>(getKey, fetcher, { revalidateFirstPage: true });
  const rows = data?.flatMap((p) => p.rows) ?? [];
  const hasNext = !!data?.[data.length - 1]?.nextCursor;

  return (
    <div className={cx("grid overflow-hidden rounded-[24px] border border-line bg-white shadow-[var(--shadow-soft)] lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]", embedded ? "h-[calc(100dvh-330px)] min-h-[520px]" : "h-[calc(100dvh-210px)] min-h-[560px]")}>
      <aside className={cx("flex min-h-0 flex-col border-r border-line", selected && "hidden lg:flex")}>
        <div className="flex flex-col gap-3 border-b border-line p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Buscar por nome ou @" aria-label="Buscar conversas" className="h-11 w-full rounded-[14px] border border-line pl-11 pr-3 text-[14px] focus:border-brand focus:outline-none" />
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtros">
            {FILTERS.map((f) => (
              <button key={f.value} onClick={() => setFilter(f.value)} aria-pressed={filter === f.value} className={cx("whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium border", filter === f.value ? "bg-selected text-brand border-[#c9ebdc]" : "border-line text-ink hover:bg-page")}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto scroll-thin">
          {error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : isLoading ? (
            <LoadingState rows={6} className="p-4" />
          ) : rows.length === 0 ? (
            <EmptyState icon={<Inbox />} title="Nenhuma conversa" description={filter === "all" && !debounced ? "Quando alguém enviar mensagem para a conta conectada, a conversa aparece aqui." : "Nada encontrado com estes filtros."} />
          ) : (
            <ul>
              {rows.map((c) => (
                <li key={c.id}>
                  <button onClick={() => setSelected(c.id)} aria-current={selected === c.id ? "true" : undefined} className={cx("flex w-full items-start gap-3 border-b border-line/70 px-4 py-3.5 text-left hover:bg-page", selected === c.id && "bg-selected/60")}>
                    <Avatar name={c.contactName} src={c.avatarUrl} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={cx("truncate text-[14.5px]", c.unreadCount ? "font-semibold" : "font-medium")}>{c.contactName}</span>
                        <InstagramGlyph size={14} className="shrink-0" />
                        <span className="ml-auto whitespace-nowrap text-[11.5px] text-muted">{relativeTime(c.lastMessageAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className={cx("truncate text-[13px]", c.unreadCount ? "text-ink" : "text-muted")}>
                          {c.lastMessageDirection === "out" && "Você: "}
                          {c.lastMessagePreview ?? "Sem mensagens"}
                        </span>
                        {c.unreadCount > 0 && <span className="ml-auto flex min-w-5 h-5 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{c.unreadCount}</span>}
                      </span>
                      <span className="mt-1 block text-[11.5px] text-muted">{c.ownerName ?? "Sem responsável"}</span>
                    </span>
                  </button>
                </li>
              ))}
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
          <ConversationPane id={selected} onBack={() => setSelected(null)} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<MessageSquareQuote />} title="Selecione uma conversa" description="Escolha uma conversa à esquerda para ler e responder sem sair do CRMLABS." />
          </div>
        )}
      </section>
      <aside className="hidden xl:block min-h-0 overflow-y-auto scroll-thin border-l border-line">{selected ? <ContactSidePane conversationId={selected} /> : null}</aside>
    </div>
  );
}
