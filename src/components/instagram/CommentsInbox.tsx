"use client";

import { useEffect, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import { ArrowLeft, CheckCheck, Image as ImageIcon, CircleCheck, ExternalLink, EyeOff, Heart, ImageOff, Lock, MessageCircle, MessageSquareReply, Plus, Search, Send, Trash2, UserRoundCheck, X } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import { shortAgo } from "@/lib/format";
import { Avatar, Button, cx, EmptyState, ErrorState, LoadingState } from "@/components/ui";
import { ChannelBadge, InstagramGlyph } from "@/components/ui/ChannelIcon";

type PostRow = { postId: string; caption: string | null; thumbnailUrl: string | null; mediaType: string | null; permalink: string | null; postedAt: string | null; pending: number; total: number; lastAt: string; lastPendingAt: string | null; authors: string[]; authorsCount: number };
type PostList = { rows: PostRow[]; hasMore: boolean; pendingTotal: number };
type Comment = {
  id: string;
  externalId: string;
  authorUsername: string | null;
  text: string | null;
  commentedAt: string;
  likeCount: number;
  isOwn: boolean;
  pending: boolean;
  hidden: boolean;
  resolvedAt: string | null;
  resolvedByName: string | null;
  contactId: string | null;
  contactName: string | null;
  contactAvatar: string | null;
  isLead: boolean;
  privateReply: { status: string; sentByName: string | null; createdAt: string } | null;
  failedReply: { status: string; error: string | null } | null;
  actions: { reply: boolean; privateReply: boolean; hide: boolean; delete: boolean; resolve: boolean };
};
type ThreadItem = Comment & { replies: Comment[]; threadPending: boolean };
type Thread = {
  post: { id: string; caption: string | null; mediaType: string | null; permalink: string | null; thumbnailUrl: string | null; mediaUrl: string | null; likeCount: number | null; commentsCount: number | null; postedAt: string | null };
  account: { username: string | null; canComment: boolean };
  thread: ThreadItem[];
  pendingCount: number;
  demo: boolean;
};

const COLORS = ["#e2702a", "#0e9488", "#8b5cf6", "#2f6fdb", "#e8476a", "#12a26b", "#e0a106"];
const colorFor = (s: string) => COLORS[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length];
const firstLine = (t: string | null) => (t ?? "").split("\n")[0].trim() || "Publicação sem legenda";
const shortDate = (v: string | null) => (v ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", day: "numeric", month: "short" }).format(new Date(v)).replace(".", "") : "");
const ago = (v: string) => shortAgo(v);

function who(r: PostRow) {
  const shown = r.authors.slice(0, 2);
  const rest = r.authorsCount - shown.length;
  if (!shown.length) return `${r.total} comentário${r.total === 1 ? "" : "s"}`;
  if (rest > 0) return `${shown.join(", ")} e mais ${rest} pessoa${rest > 1 ? "s" : ""}`;
  return `${shown.join(" e ")} ${shown.length > 1 ? "comentaram" : "comentou"}`;
}

function Thumb({ url, size = 56, className }: { url: string | null; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={cx("relative block shrink-0 overflow-hidden rounded-[14px] bg-page", className)} style={{ width: size, height: size }}>
      {url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="size-full object-cover" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="flex size-full items-center justify-center text-muted">
          <ImageOff className="size-5" aria-hidden />
        </span>
      )}
    </span>
  );
}

function CommentAvatar({ c, account }: { c: Comment; account: string | null }) {
  const name = c.isOwn ? (account ?? "conta") : (c.authorUsername ?? "?");
  if (c.contactAvatar) return <Avatar name={name} src={c.contactAvatar} size={36} />;
  return (
    <span className={cx("flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white", c.isOwn && "ring-2 ring-selected")} style={{ background: c.isOwn ? "#008a65" : colorFor(name) }} aria-hidden>
      {name.replace(/^@/, "")[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

function ReplyBox({ c, kind, onClose, onSent }: { c: Comment; kind: "public" | "private"; onClose: () => void; onSent: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const req = useRef<string | null>(null);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    req.current ??= crypto.randomUUID();
    try {
      const r = await api.post<{ status: string; error: string | null }>(`/api/comments/${c.id}/reply`, { kind, text: text.trim(), clientRequestId: req.current });
      req.current = null;
      if (r.status === "failed") toast.error(r.error ?? "O Instagram recusou a resposta.");
      else if (r.status === "unconfirmed") toast.warning(r.error ?? "Resposta não confirmada.");
      else toast.success(kind === "public" ? "Resposta publicada." : "Resposta enviada no Direct.");
      onSent();
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="anim-fade mt-2 rounded-[16px] border border-brand/40 bg-white p-2.5 shadow-sm">
      <p className="mb-1.5 flex items-center gap-1.5 px-1 text-[12.5px] text-muted">
        {kind === "private" ? <Lock className="size-3.5" aria-hidden /> : <MessageSquareReply className="size-3.5" aria-hidden />}
        {kind === "private" ? "Resposta privada no Direct para" : "Respondendo"} <b className="text-ink">@{c.authorUsername ?? "usuário"}</b>
        {kind === "private" && <span className="text-[11.5px]">· uma por comentário, até 7 dias</span>}
      </p>
      <div className="flex items-end gap-2">
        <textarea
          autoFocus
          aria-label="Sua resposta"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
            if (e.key === "Escape") onClose();
          }}
          rows={1}
          maxLength={1000}
          placeholder="Digite sua resposta"
          className="max-h-32 min-h-[38px] flex-1 resize-none rounded-[12px] bg-page/70 px-3 py-2 text-[14px] outline-none focus:bg-page"
        />
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Cancelar">
          <X className="size-4" />
        </Button>
        <Button size="sm" loading={busy} disabled={!text.trim()} icon={<Send className="size-4" />} onClick={send}>
          Enviar
        </Button>
      </div>
    </div>
  );
}

function CommentRow({ c, account, nested, highlight, onChanged }: { c: Comment; account: string | null; nested?: boolean; highlight?: boolean; onChanged: () => void }) {
  const openContact = useOpenContact();
  const [reply, setReply] = useState<"public" | "private" | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlight) ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlight]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(ok);
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const createLead = () =>
    act(async () => {
      let contactId = c.contactId;
      if (!contactId) contactId = (await api.post<{ contactId: string }>(`/api/comments/${c.id}/link`, { createContact: true })).contactId;
      await api.post(`/api/contacts/${contactId}/lead`, { from: "comment" });
    }, "Lead criado no funil do Social Seller.");
  const link = "text-[12.5px] font-medium text-muted hover:text-ink disabled:opacity-50";
  return (
    <div ref={ref} className={cx("flex gap-3", nested ? "pt-3" : "", highlight && "rounded-[14px] bg-selected/50 -mx-2 px-2 py-1")}>
      <CommentAvatar c={c} account={account} />
      <div className="min-w-0 flex-1">
        <p className={cx("text-[14.5px] leading-snug", c.hidden && "opacity-60")}>
          <b className="mr-1.5 font-semibold">{c.isOwn ? (account ?? "Você") : (c.authorUsername ?? "usuário")}</b>
          {c.isLead && !c.isOwn && (
            <button onClick={() => c.contactId && openContact(c.contactId)} className="mr-1.5 inline-flex translate-y-[-1px] items-center gap-0.5 rounded-full bg-selected px-1.5 py-0.5 align-middle text-[10.5px] font-semibold text-brand-dark">
              <UserRoundCheck className="size-3" aria-hidden /> Lead
            </button>
          )}
          <span className="whitespace-pre-wrap break-words">{c.text}</span>
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <span className="text-[12px] text-muted">{ago(c.commentedAt)}</span>
          {c.likeCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[12px] text-muted">
              <Heart className="size-3" aria-hidden /> {c.likeCount} curtida{c.likeCount > 1 ? "s" : ""}
            </span>
          )}
          {c.actions.reply && (
            <button className={link} onClick={() => setReply(reply === "public" ? null : "public")}>
              Responder
            </button>
          )}
          {c.actions.privateReply && (
            <button className={link} onClick={() => setReply(reply === "private" ? null : "private")}>
              Responder no Direct
            </button>
          )}
          {c.actions.hide && (
            <button className={link} disabled={busy} onClick={() => act(() => api.post(`/api/comments/${c.id}/hide`, { hide: !c.hidden }), c.hidden ? "Comentário visível de novo." : "Comentário ocultado no Instagram.")}>
              {c.hidden ? "Mostrar" : "Ocultar"}
            </button>
          )}
          {c.actions.delete && (
            <button className={link} disabled={busy} onClick={() => confirm("Excluir este comentário no Instagram? Isso não pode ser desfeito.") && act(() => api.del(`/api/comments/${c.id}`), "Comentário excluído.")}>
              Excluir
            </button>
          )}
          {c.actions.resolve && (
            <button className={link} disabled={busy} onClick={() => act(() => api.post(`/api/comments/${c.id}/resolve`, { resolved: true }), "Marcado como resolvido.")}>
              Marcar como resolvido
            </button>
          )}
          {!c.isOwn && !c.isLead && (
            <button className={cx(link, "inline-flex items-center gap-0.5")} disabled={busy} onClick={createLead}>
              <Plus className="size-3" aria-hidden /> Criar Lead
            </button>
          )}
          {c.pending && <span className="rounded-full bg-selected px-2 py-0.5 text-[11.5px] font-semibold text-brand">Sem resposta</span>}
          {c.hidden && (
            <span className="inline-flex items-center gap-1 rounded-full bg-page px-2 py-0.5 text-[11.5px] text-muted">
              <EyeOff className="size-3" aria-hidden /> Oculto
            </span>
          )}
          {!c.pending && !c.isOwn && c.resolvedByName && !c.hidden && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-success">
              <CheckCheck className="size-3" aria-hidden /> {c.resolvedByName.split(" ")[0]}
            </span>
          )}
          {c.privateReply && (
            <span className="inline-flex items-center gap-1 text-[11.5px] text-info">
              <Lock className="size-3" aria-hidden /> Respondido no Direct{c.privateReply.sentByName ? ` por ${c.privateReply.sentByName.split(" ")[0]}` : ""}
            </span>
          )}
        </div>
        {c.failedReply && <p className="mt-1 text-[12px] text-danger">{c.failedReply.error ?? "Última resposta não confirmada."}</p>}
        {reply && <ReplyBox c={c} kind={reply} onClose={() => setReply(null)} onSent={onChanged} />}
      </div>
    </div>
  );
}

function PostPreview({ t, compact }: { t: Thread; compact?: boolean }) {
  const p = t.post;
  const video = p.mediaType === "VIDEO" || p.mediaType === "REELS";
  return (
    <div className={cx("flex flex-col", compact ? "gap-3" : "h-full")}>
      <div className={cx("relative overflow-hidden bg-[#0f1f1a]", compact ? "aspect-[4/5] max-h-[360px] rounded-[18px]" : "aspect-[4/5] w-full")}>
        {video && p.mediaUrl ? (
          <video src={p.mediaUrl} poster={p.thumbnailUrl ?? undefined} controls playsInline preload="metadata" className="size-full object-contain" />
        ) : p.mediaUrl || p.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.mediaUrl ?? p.thumbnailUrl!} alt="Publicação" className="size-full object-contain" />
        ) : (
          <span className="flex size-full items-center justify-center text-white/60">
            <ImageOff className="size-8" aria-hidden />
          </span>
        )}
      </div>
      <div className={cx(compact ? "" : "flex-1 overflow-y-auto scroll-thin p-5")}>
        <div className="flex items-center gap-4 text-[14px]">
          <span className="inline-flex items-center gap-1.5">
            <Heart className="size-[18px]" aria-hidden /> {p.likeCount ?? "—"}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle className="size-[18px]" aria-hidden /> {p.commentsCount ?? "—"}
          </span>
        </div>
        {p.postedAt && <p className="mt-2 text-[12.5px] text-muted">Publicado em {new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(p.postedAt)).replace(",", " às")}</p>}
        {p.caption && <p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-relaxed">{p.caption}</p>}
        {p.permalink && (
          <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand hover:underline">
            Abrir no Instagram <ExternalLink className="size-4" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}

function PostThread({ postId, focus, onBack }: { postId: string; focus: string; onBack: () => void }) {
  const { mutate: gm } = useSWRConfig();
  const { data: t, error, mutate } = useSWR<Thread>(`/api/instagram/posts/${postId}`, fetcher);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPost, setShowPost] = useState(false);
  const refresh = () => {
    mutate();
    gm((k) => typeof k === "string" && (k.startsWith("/api/instagram") || k === "/api/me"));
  };
  if (error) return <ErrorState error={error} onRetry={() => mutate()} />;
  if (!t) return <LoadingState rows={5} className="p-6" />;
  const resolveAll = async () => {
    if (!confirm(`Marcar os ${t.pendingCount} comentário(s) sem resposta desta publicação como resolvidos?`)) return;
    try {
      const r = await api.post<{ resolved: number }>(`/api/instagram/posts/${postId}/resolve-all`);
      toast.success(`${r.resolved} comentário(s) resolvido(s).`);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const comment = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api.post(`/api/instagram/posts/${postId}/comment`, { text: text.trim() });
      setText("");
      toast.success("Comentário publicado.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const p = t.post;
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-4">
          <button onClick={onBack} className="flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-page lg:hidden" aria-label="Voltar">
            <ArrowLeft className="size-5" />
          </button>
          <button onClick={() => setShowPost((v) => !v)} className="shrink-0 2xl:pointer-events-none" aria-label="Ver publicação" title="Ver publicação">
            <Thumb url={p.thumbnailUrl} size={44} />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold">{firstLine(p.caption)}</p>
            <p className="truncate text-[12.5px] text-muted">
              {p.likeCount ?? 0} curtida{p.likeCount === 1 ? "" : "s"} · {p.commentsCount ?? t.thread.length} comentário{p.commentsCount === 1 ? "" : "s"}
              {p.postedAt ? ` · ${shortDate(p.postedAt)}` : ""}
            </p>
          </div>
          {t.pendingCount > 0 && (
            <Button size="sm" variant="secondary" icon={<CircleCheck className="size-4 text-brand" />} onClick={resolveAll}>
              <span className="hidden sm:inline">Resolver todos</span>
              <span className="sm:hidden">{t.pendingCount}</span>
            </Button>
          )}
          <button onClick={() => setShowPost((v) => !v)} aria-pressed={showPost} className={cx("flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium 2xl:hidden", showPost ? "bg-selected text-brand" : "text-muted hover:bg-page hover:text-ink")}>
            <ImageIcon className="size-4" aria-hidden /> <span className="hidden sm:inline">Publicação</span>
          </button>
          {p.permalink && (
            <a href={p.permalink} target="_blank" rel="noopener noreferrer" className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page hover:text-ink" aria-label="Abrir no Instagram">
              <ExternalLink className="size-[18px]" />
            </a>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-[#f7faf9] px-3 py-4 sm:px-5">
          {showPost && (
            <div className="mx-auto mb-4 max-w-[420px] 2xl:hidden">
              <PostPreview t={t} compact />
            </div>
          )}
          {t.demo && <p className="mb-3 rounded-[12px] bg-warning-soft px-3 py-2 text-[12.5px] text-warning">Modo demonstração: responder, ocultar e excluir no Instagram ficam desativados.</p>}
          {t.thread.length === 0 ? (
            <EmptyState icon={<MessageCircle />} title="Sem comentários" />
          ) : (
            <ul className="flex flex-col gap-3">
              {t.thread.map((root, i) => (
                <li key={root.id} className={cx("anim-fade rounded-[20px] border p-3.5 sm:p-4", root.threadPending ? "border-brand/35 bg-white shadow-[0_1px_3px_rgb(0_138_101/0.08)]" : "border-transparent bg-transparent")} style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
                  <CommentRow c={root} account={t.account.username} highlight={focus === root.id} onChanged={refresh} />
                  {root.replies.length > 0 && (
                    <div className="ml-[18px] mt-1 border-l-2 border-line pl-[30px]">
                      {root.replies.map((r) => (
                        <CommentRow key={r.id} c={r} account={t.account.username} nested highlight={focus === r.id} onChanged={refresh} />
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {t.account.canComment && (
          <footer className="border-t border-line bg-white p-3">
            <div className="flex items-end gap-2 rounded-[18px] border border-line p-1.5 pl-3 focus-within:border-brand">
              <textarea
                aria-label="Comentar no post"
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    comment();
                  }
                }}
                rows={1}
                maxLength={2200}
                placeholder={`Comentar como @${t.account.username ?? "conta"}…`}
                className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14.5px] outline-none placeholder:text-[#8a99a3]"
              />
              <button onClick={comment} disabled={!text.trim() || busy} aria-label="Publicar comentário" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-white disabled:opacity-40">
                <Send className="size-[18px]" aria-hidden />
              </button>
            </div>
          </footer>
        )}
      </div>
      <aside className="hidden min-h-0 border-l border-line 2xl:block">
        <PostPreview t={t} />
      </aside>
    </div>
  );
}

export function CommentsInbox() {
  const me = useMe();
  const [post, setPost] = useQueryParam("post", "");
  const [focus] = useQueryParam("comentario", "");
  const [filter, setFilter] = useQueryParam("filtro", "pending");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const f = filter === "all" ? "all" : "pending";
  const getKey = (i: number, prev: PostList | null) => (prev && !prev.hasMore ? null : `/api/instagram/posts${qs({ filter: f, q: debounced, offset: i * 30 })}`);
  const { data, error, isLoading, size, setSize, mutate } = useSWRInfinite<PostList>(getKey, fetcher, { keepPreviousData: true, revalidateFirstPage: true });
  const rows = data?.flatMap((p) => p.rows) ?? [];
  const pendingTotal = data?.[0]?.pendingTotal ?? me.counts.pendingComments ?? 0;

  return (
    <div className="grid h-[calc(100dvh-250px)] min-h-[540px] overflow-hidden rounded-[24px] border border-line bg-white shadow-[var(--shadow-soft)] lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
      <aside className={cx("flex min-h-0 flex-col border-r border-line", post && "hidden lg:flex")}>
        <div className="flex flex-col gap-3 border-b border-line px-4 pb-3 pt-4">
          <p className="text-[14px]">
            <b className="text-[16px] font-bold">{pendingTotal}</b> <span className="text-muted">comentário{pendingTotal === 1 ? "" : "s"} esperando resposta</span>
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Pesquisar publicação, @ ou comentário" aria-label="Pesquisar comentários" className="h-11 w-full rounded-[14px] border border-line bg-page/60 pl-11 pr-3 text-[14px] focus:border-brand focus:bg-white focus:outline-none" />
          </div>
          <div className="inline-flex self-start rounded-[12px] bg-page p-1" role="tablist" aria-label="Filtro">
            {(
              [
                ["pending", "Sem resposta"],
                ["all", "Todos"],
              ] as const
            ).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={f === v} onClick={() => setFilter(v)} className={cx("rounded-[9px] px-3 py-1.5 text-[13px] font-medium transition-colors", f === v ? "bg-white text-brand shadow-sm" : "text-muted hover:text-ink")}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {error ? (
            <ErrorState error={error} onRetry={() => mutate()} />
          ) : isLoading && !data ? (
            <LoadingState rows={6} className="p-4" />
          ) : rows.length === 0 ? (
            <EmptyState icon={f === "pending" && !debounced ? <CheckCheck /> : <MessageCircle />} title={f === "pending" && !debounced ? "Tudo respondido" : "Nada por aqui"} description={f === "pending" && !debounced ? "Nenhum comentário esperando resposta." : debounced ? "Nada encontrado com esta pesquisa." : "Os comentários das publicações aparecem aqui."} />
          ) : (
            <ul>
              {rows.map((r, i) => (
                <li key={r.postId} className="anim-fade" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
                  <button onClick={() => setPost(r.postId)} aria-current={post === r.postId ? "true" : undefined} className={cx("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-page", post === r.postId && "bg-selected/70")}>
                    <span className="relative">
                      <Thumb url={r.thumbnailUrl} size={52} />
                      <ChannelBadge />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className={cx("truncate text-[14.5px]", r.pending ? "font-semibold" : "font-medium text-ink/90")}>{firstLine(r.caption)}</span>
                        <span className="ml-auto shrink-0 text-[11.5px] text-muted">{ago(r.lastPendingAt ?? r.lastAt)}</span>
                      </span>
                      <span className="mt-0.5 flex items-center gap-2">
                        <span className="truncate text-[13px] text-muted">{who(r)}</span>
                        {r.pending > 0 && <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white">{r.pending}</span>}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {data?.[data.length - 1]?.hasMore && (
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
      <section className={cx("min-h-0 min-w-0", !post && "hidden lg:block")}>
        {post ? (
          <PostThread key={post} postId={post} focus={focus} onBack={() => setPost("")} />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState icon={<InstagramGlyph size={28} />} title="Escolha uma publicação" description="Veja os comentários organizados em conversas, com a publicação ao lado para entender o contexto." />
          </div>
        )}
      </section>
    </div>
  );
}

