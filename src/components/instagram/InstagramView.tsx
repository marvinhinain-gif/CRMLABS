"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import useSWRInfinite from "swr/infinite";
import { toast } from "sonner";
import { CircleAlert, History, MessageCircle, RefreshCw, Send } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { relativeTime } from "@/lib/format";
import { Button, Card, cx, DemoBadge, EmptyState, ErrorState, LoadingState, PageHeader, Select, Tabs } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { ConversationsView } from "@/components/conversations/ConversationsView";
import { CommentsInbox } from "./CommentsInbox";

type Summary = {
  account: { username: string | null; status: string; capabilities: { connected: boolean; sendMessages: boolean; readComments: boolean }; lastCheckedAt: string | null } | null;
  pendingDirects: number;
  pendingComments: number;
};

type HistoryRow = { id: string; action: string; data: Record<string, unknown>; createdAt: string; actorId: string | null; actorName: string | null; roleLabel: string | null; link: string | null };

const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", weekday: "long", day: "2-digit", month: "long" });

function describe(r: HistoryRow): { text: React.ReactNode; detail?: string | null; tone?: "danger" } {
  const d = r.data;
  const at = (v: unknown) => (v ? <b className="font-semibold">@{String(v).replace(/^@/, "")}</b> : <b>usuário</b>);
  const post = d.postCaption ? `Post: “${String(d.postCaption).slice(0, 60)}${String(d.postCaption).length > 60 ? "…" : ""}”` : null;
  const failed = d.status === "failed" || d.status === "unconfirmed";
  switch (r.action) {
    case "instagram.dm_sent":
      return { text: <>Respondeu Direct de {at(d.to)}{failed ? " — não confirmado" : ""}</>, detail: d.preview ? `“${d.preview}”` : null, tone: failed ? "danger" : undefined };
    case "instagram.dm_resolved":
      return { text: <>Marcou o Direct de {at(d.to)} como resolvido</> };
    case "instagram.dm_reopened":
      return { text: <>Reabriu o Direct de {at(d.to)}</> };
    case "instagram.comment_replied":
      return { text: <>{d.kind === "private" ? "Respondeu no Direct o comentário de " : "Respondeu comentário de "}{at(d.author)}{failed ? " — não confirmado" : ""}</>, detail: [post, d.preview ? `“${d.preview}”` : null].filter(Boolean).join(" · "), tone: failed ? "danger" : undefined };
    case "instagram.comment_resolved":
      return { text: <>Marcou comentário de {at(d.author)} como resolvido</>, detail: post };
    case "instagram.comment_reopened":
      return { text: <>Reabriu comentário de {at(d.author)}</>, detail: post };
    case "instagram.comments_resolved_all":
      return { text: <>Resolveu {String(d.count ?? 0)} comentário(s) de uma publicação</>, detail: post };
    case "instagram.comment_hidden":
      return { text: <>Ocultou comentário de {at(d.author)}</>, detail: post };
    case "instagram.comment_unhidden":
      return { text: <>Mostrou de novo o comentário de {at(d.author)}</>, detail: post };
    case "instagram.comment_deleted":
      return { text: <>Excluiu comentário de {at(d.author)}</>, detail: [post, d.preview ? `“${d.preview}”` : null].filter(Boolean).join(" · ") };
    case "instagram.post_commented":
      return { text: <>Comentou na publicação{failed ? " — falhou" : ""}</>, detail: [post, d.preview ? `“${d.preview}”` : null].filter(Boolean).join(" · "), tone: failed ? "danger" : undefined };
    case "instagram.lead_created":
      return { text: <>Criou lead {d.username ? at(d.username) : <b>{String(d.name ?? "")}</b>} a partir {d.from === "comment" ? "de um comentário" : "do Direct"}</> };
    default:
      return { text: r.action.replace("instagram.", "") };
  }
}

function HistoryView() {
  const team = useTeam();
  const [kind, setKind] = useState("all");
  const [userId, setUserId] = useState("");
  const getKey = (_i: number, prev: { nextBefore: string | null } | null) => (prev && !prev.nextBefore ? null : `/api/instagram/history${qs({ kind, userId, before: prev?.nextBefore ?? undefined })}`);
  const { data, error, isLoading, size, setSize } = useSWRInfinite<{ rows: HistoryRow[]; nextBefore: string | null }>(getKey, fetcher);
  const rows = data?.flatMap((p) => p.rows) ?? [];
  let lastDay = "";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <Select aria-label="Tipo" value={kind} onChange={(e) => setKind(e.target.value)} className="w-auto bg-white">
          <option value="all">Todas as ações</option>
          <option value="directs">Directs</option>
          <option value="comments">Comentários</option>
          <option value="leads">Leads criados</option>
        </Select>
        <Select aria-label="Pessoa" value={userId} onChange={(e) => setUserId(e.target.value)} className="w-auto bg-white">
          <option value="">Toda a equipe</option>
          {team.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name}
            </option>
          ))}
        </Select>
      </div>
      {error ? (
        <ErrorState error={error} />
      ) : isLoading && !data ? (
        <LoadingState rows={5} />
      ) : rows.length === 0 ? (
        <Card>
          <EmptyState icon={<History />} title="Nada registrado ainda" description="Respostas, resoluções e leads criados pelo Instagram aparecem aqui, com quem fez e quando." />
        </Card>
      ) : (
        <Card className="px-4 py-2 sm:px-6">
          <ol>
            {rows.map((r) => {
              const day = dayFmt.format(new Date(r.createdAt));
              const header = day !== lastDay ? ((lastDay = day), day) : null;
              const d = describe(r);
              return (
                <li key={r.id}>
                  {header && <p className="mt-4 mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted first-letter:uppercase">{header}</p>}
                  <div className="flex gap-3 border-b border-line py-3 last:border-0">
                    <span className="w-12 shrink-0 pt-0.5 text-[13px] font-semibold tabular-nums">{timeFmt.format(new Date(r.createdAt))}</span>
                    <TeamAvatar userId={r.actorId} name={r.actorName ?? "?"} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px]">
                        <b className="font-semibold">{r.actorName ?? "Sistema"}</b>
                        {r.roleLabel && <span className="text-muted"> — {r.roleLabel}</span>}
                      </p>
                      <p className={cx("text-[14px]", d.tone === "danger" && "text-danger")}>{d.text}</p>
                      {d.detail && <p className="mt-0.5 truncate text-[12.5px] text-muted">{d.detail}</p>}
                    </div>
                    {r.link && (
                      <Link href={r.link} className="shrink-0 self-center text-[13px] font-medium text-brand hover:underline">
                        {r.action.startsWith("instagram.dm") ? "Ver conversa" : r.action === "instagram.lead_created" ? "Ver lead" : "Ver interação"}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {data?.[data.length - 1]?.nextBefore && (
            <div className="py-3">
              <Button variant="secondary" size="sm" className="w-full" onClick={() => setSize(size + 1)}>
                Carregar mais
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** Caixa de entrada comercial do Instagram: Directs, Comentários e Histórico (administrador). */
export function InstagramView() {
  const me = useMe();
  const { mutate } = useSWRConfig();
  const [tab, setTab] = useQueryParam("aba", "directs");
  const { data } = useSWR<Summary>("/api/instagram", fetcher, { refreshInterval: 60_000 });
  const [syncing, setSyncing] = useState(false);
  const acc = data?.account;
  const connected = acc?.status === "connected";
  const sync = async () => {
    setSyncing(true);
    try {
      await api.post("/api/instagram/sync");
      mutate((k) => typeof k === "string" && (k.startsWith("/api/instagram") || k.startsWith("/api/conversations") || k === "/api/me"));
      toast.success("Instagram atualizado.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };
  const items = [
    { value: "directs", label: "Directs", icon: <Send />, count: data?.pendingDirects },
    { value: "comentarios", label: "Comentários", icon: <MessageCircle />, count: data?.pendingComments },
    ...(me.user.role === "admin" ? [{ value: "historico", label: "Histórico", icon: <History /> }] : []),
  ];
  return (
    <div className="mx-auto flex max-w-[1700px] flex-col gap-4">
      <PageHeader
        title={tab === "comentarios" ? "Comentários" : tab === "historico" ? "Histórico" : "Directs"}
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        actions={
          <div className="flex items-center gap-2">
            {acc ? (
              <span className="inline-flex h-11 items-center gap-2 rounded-[14px] border border-line bg-white px-3.5 text-[14px]">
                <b className="font-semibold">@{acc.username}</b>
                <span className={cx("inline-flex items-center gap-1.5 text-[12.5px]", connected ? "text-success" : "text-warning")}>
                  <span className={cx("size-2 rounded-full", connected ? "bg-[#12a26b]" : "bg-[#e0a106]")} aria-hidden />
                  {connected ? "Conectado" : acc.status === "reconnect_required" ? "Reconectar" : "Atenção"}
                </span>
              </span>
            ) : data ? (
              <Link href="/configuracoes?aba=integracoes" className="inline-flex h-11 items-center gap-2 rounded-[14px] border border-[#f1d9a6] bg-warning-soft px-3.5 text-[13.5px] text-warning">
                <CircleAlert className="size-4" aria-hidden /> Conectar Instagram
              </Link>
            ) : null}
            {connected && tab !== "historico" && (
              <Button variant="secondary" size="sm" className="h-11" icon={<RefreshCw className={cx("size-4", syncing && "animate-spin")} />} onClick={sync} disabled={syncing} title={acc?.lastCheckedAt ? `Atualizado ${relativeTime(acc.lastCheckedAt).toLowerCase()}` : undefined}>
                <span className="hidden sm:inline">Atualizar</span>
              </Button>
            )}
          </div>
        }
      />
      <Tabs value={tab} onChange={setTab} className="self-start max-w-full overflow-x-auto" items={items} />
      {tab === "comentarios" ? <CommentsInbox /> : tab === "historico" && me.user.role === "admin" ? <HistoryView /> : <ConversationsView />}
    </div>
  );
}
