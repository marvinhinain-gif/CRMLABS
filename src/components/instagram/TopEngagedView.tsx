"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ArrowLeft, ArrowUpRight, AtSign, BadgeCheck, CircleSlash, ExternalLink, Info, MessageCircle, Plus, Search, Send, Settings2, Share2, Sparkles, ThumbsDown, Trophy, Undo2, UserRound, Users, X } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact } from "@/lib/nav";
import { dayKey, formatDate, formatTime, plural, relativeTime } from "@/lib/format";
import {
  API_LIMITATIONS,
  CRM_STATUS_LABEL,
  ENGAGEMENT_ACTIONS,
  KIND_FILTER_LABEL,
  KIND_FILTERS,
  TRACKED_KINDS,
  UNTRACKED_KINDS,
  type CrmStatus,
  type EngagementKind,
  type EngagementPeriod,
  type KindFilter,
} from "@/lib/engagement";
import { Avatar, Badge, Button, Card, cx, Dialog, EmptyState, ErrorState, IconButton, Input, LoadingState, Select, Sheet, SheetClose, Switch, Tabs } from "@/components/ui";
import { CountUp } from "@/components/motion/CountUp";
import { TransformLeadDialog } from "./TransformLeadDialog";

type Person = {
  key: string;
  position: number;
  score: number;
  interactions: number;
  capped: number;
  lastAt: string;
  counts: Record<EngagementKind, number>;
  contactId: string | null;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: CrmStatus;
  canTransform: boolean;
  icp: IcpMark;
};

type IcpMark = "yes" | "no" | null;

type Ranking = {
  totals: { people: number; interactions: number; comments: number; directs: number; opportunities: number; outOfIcp: number };
  rows: Person[];
  canClassifyIcp: boolean;
  weights: Record<EngagementKind, number>;
  dailyCap: number;
  canConfigure: boolean;
};

type Activity = {
  id: string;
  kind: EngagementKind;
  at: string;
  text: string | null;
  restricted: boolean;
  excluded: boolean;
  excludedReason: string | null;
  post: { caption: string | null; type: string | null; permalink: string | null; thumbnailUrl: string | null } | null;
  link: string | null;
  externalUrl: string | null;
  externalLabel: string | null;
};

type PersonDetail = Person & { firstAt: string | null; inRanking: boolean; canClassifyIcp: boolean; activities: Activity[] };

const PERIOD_ITEMS: { value: EngagementPeriod; label: string }[] = [
  { value: "today", label: "Hoje" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Mês" },
];
const PERIOD_TEXT: Record<EngagementPeriod, string> = { today: "hoje", week: "nesta semana", month: "neste mês" };

const KIND_ICON: Record<EngagementKind, React.ReactNode> = {
  comment: <MessageCircle />,
  dm: <Send />,
  story_reply: <Sparkles />,
  story_mention: <AtSign />,
  dm_share: <Share2 />,
};

const STATUS_TONE: Record<CrmStatus, "neutral" | "brand" | "info" | "success"> = { none: "neutral", lead: "brand", closer: "info", client: "success" };

const displayName = (p: Pick<Person, "name" | "username">) => (p.username ? `@${p.username}` : (p.name ?? "Pessoa do Instagram"));

function Medal({ position }: { position: number }) {
  if (!position) return <span className="w-8 shrink-0 text-center text-[14px] text-muted" aria-hidden>—</span>;
  const m = ["🥇", "🥈", "🥉"][position - 1];
  return m ? (
    <span className="w-8 shrink-0 text-center text-[22px] leading-none" aria-label={`${position}º lugar`}>
      {m}
    </span>
  ) : (
    <span className="w-8 shrink-0 text-center text-[14px] font-semibold tabular-nums text-muted">{position}º</span>
  );
}

function ActionChips({ counts, compact }: { counts: Record<EngagementKind, number>; compact?: boolean }) {
  const items = TRACKED_KINDS.filter((k) => counts[k] > 0);
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5 rounded-full bg-page px-2.5 py-1 text-[12.5px] text-ink [&>svg]:size-3.5 [&>svg]:text-muted" title={ENGAGEMENT_ACTIONS[k].label}>
          {KIND_ICON[k]}
          <span className="tabular-nums font-medium">{counts[k]}</span>
          {!compact && <span className="text-muted">{counts[k] === 1 ? ENGAGEMENT_ACTIONS[k].label.toLowerCase() : ENGAGEMENT_ACTIONS[k].plural}</span>}
        </li>
      ))}
    </ul>
  );
}

function Kpi({ icon, label, value, sub, i }: { icon: React.ReactNode; label: string; value: number; sub: string; i: number }) {
  return (
    <div className="anim-rise min-w-0" style={{ "--i": i + 1 } as React.CSSProperties}>
      <Card className="h-full p-4">
        <span className="flex size-9 items-center justify-center rounded-[12px] bg-selected text-brand [&>svg]:size-[18px]" aria-hidden>
          {icon}
        </span>
        <p className="mt-2.5 text-[13px] font-medium text-ink">{label}</p>
        <p className="text-[24px] font-bold leading-tight tracking-tight text-[#0f1f1a]">
          <CountUp value={value} delay={i * 60} />
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted">{sub}</p>
      </Card>
    </div>
  );
}

/** Abre o fluxo "Transformar em Lead" existente: primeiro garante o contato, depois a confirmação do Social Seller. */
function useTransform(onDone: () => void) {
  const [target, setTarget] = useState<{ contact: { id: string; name: string; username: string | null; avatarUrl: string | null }; from: "direct" | "comment" } | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const start = async (p: Person) => {
    setBusyKey(p.key);
    try {
      setTarget(await api.post("/api/instagram/engajados/lead", { key: p.key }));
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusyKey(null);
    }
  };
  const dialog = target ? <TransformLeadDialog open onOpenChange={(v) => !v && setTarget(null)} contact={target.contact} from={target.from} onDone={onDone} /> : null;
  return { start, busyKey, dialog };
}

function StatusBadge({ p }: { p: Pick<Person, "status" | "ownerName"> }) {
  return (
    <Badge tone={STATUS_TONE[p.status]}>
      {p.status === "none" ? <CircleSlash className="size-3.5" aria-hidden /> : <UserRound className="size-3.5" aria-hidden />}
      {CRM_STATUS_LABEL[p.status]}
    </Badge>
  );
}

/** Classificação de ICP: "não é ICP" tira a pessoa do Top 15 e o próximo sobe; vale para todos os períodos. */
function useIcp() {
  const { mutate } = useSWRConfig();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const refresh = () => mutate((k) => typeof k === "string" && k.startsWith("/api/instagram/engajados"));
  const set = async (p: Person, value: IcpMark, opts: { undo?: boolean } = {}) => {
    setBusyKey(p.key);
    try {
      await api.post("/api/instagram/engajados/icp", { key: p.key, value });
      await refresh();
      if (opts.undo) return;
      const undo = { label: "Desfazer", onClick: () => set(p, p.icp, { undo: true }) };
      const who = displayName(p);
      if (value === "no") toast.success(`${who} saiu do Top 15 (não é ICP).`, { action: undo });
      else if (value === "yes") toast.success(`${who} marcado como ICP.`, { action: undo });
      else toast.success(p.icp === "no" ? `${who} voltou ao ranking.` : `${who} sem classificação de ICP.`, { action: undo });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Não foi possível salvar a classificação.");
    } finally {
      setBusyKey(null);
    }
  };
  return { set, busyKey };
}

function IcpControl({ p, busy, onSet, className }: { p: Person; busy: boolean; onSet: (v: IcpMark) => void; className?: string }) {
  if (p.icp === "no")
    return (
      <Button variant="secondary" size="sm" icon={<Undo2 className="size-4" />} onClick={() => onSet(null)} disabled={busy} className={className}>
        Voltar ao ranking
      </Button>
    );
  return (
    <div role="group" aria-label="Classificação de ICP" className={cx("inline-flex overflow-hidden rounded-full border border-line bg-white text-[12.5px] font-medium", className)}>
      <button
        type="button"
        aria-pressed={p.icp === "yes"}
        disabled={busy}
        onClick={() => onSet(p.icp === "yes" ? null : "yes")}
        title={p.icp === "yes" ? "Tirar a marcação de ICP" : "Marcar como meu ICP"}
        className={cx("inline-flex h-8 grow items-center justify-center gap-1.5 px-3 transition-colors disabled:opacity-60", p.icp === "yes" ? "bg-selected text-brand" : "text-ink hover:bg-page")}
      >
        <BadgeCheck className="size-4" aria-hidden />
        {p.icp === "yes" ? "Meu ICP" : "É meu ICP"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => onSet("no")}
        title="Não é ICP: sai do Top 15 e dá lugar ao próximo"
        className="inline-flex h-8 grow items-center justify-center gap-1.5 border-l border-line px-3 text-ink transition-colors hover:bg-page disabled:opacity-60"
      >
        <ThumbsDown className="size-4" aria-hidden />
        Não é ICP
      </button>
    </div>
  );
}

function IcpBadge({ p }: { p: Person }) {
  if (p.icp === "yes") return <Badge tone="success">ICP</Badge>;
  if (p.icp === "no") return <Badge tone="neutral">Fora do ICP</Badge>;
  return null;
}

function TransformButton({ p, busy, onClick, className }: { p: Person; busy: boolean; onClick: () => void; className?: string }) {
  if (p.canTransform)
    return (
      <Button size="sm" icon={<Plus className="size-4" />} onClick={onClick} disabled={busy} className={className}>
        Transformar em Lead
      </Button>
    );
  if (p.status === "none") return <span className="text-[12.5px] text-muted">{p.ownerName ? `Contato de ${p.ownerName}` : "Sem responsável · um gestor distribui"}</span>;
  return null;
}

function RankRow({ p, onOpen, onTransform, busy, icp }: { p: Person; onOpen: () => void; onTransform: () => void; busy: boolean; icp: { busy: boolean; onSet: (v: IcpMark) => void } | null }) {
  const podium = p.position <= 3 && p.icp !== "no";
  return (
    <li className={cx("anim-rise border-b border-line last:border-0", podium && "bg-[#f7fbf9]")} style={{ "--i": Math.min(p.position, 10) } as React.CSSProperties}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-4 py-4 sm:px-6 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto] lg:items-center">
        <div className="flex items-center gap-3">
          <Medal position={p.icp === "no" ? 0 : p.position} />
          <span className={cx("rounded-full", podium && "ring-2 ring-[#c9ebdc] ring-offset-2")}>
            <Avatar name={p.name ?? p.username} src={p.avatarUrl} size={48} />
          </span>
        </div>
        <button type="button" onClick={onOpen} className="min-w-0 text-left">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-semibold text-ink">{displayName(p)}</span>
            <IcpBadge p={p} />
          </p>
          {p.username && p.name && p.name !== `@${p.username}` && <p className="truncate text-[13px] text-muted">{p.name}</p>}
          <p className="mt-0.5 text-[12.5px] text-muted">
            {plural(p.interactions, "interação identificada", "interações identificadas")} · Última {relativeTime(p.lastAt).toLowerCase()}
          </p>
          <div className="mt-2 hidden sm:block">
            <ActionChips counts={p.counts} compact />
          </div>
        </button>
        <div className="col-span-2 flex items-center justify-between gap-3 lg:col-span-1 lg:flex-col lg:items-end lg:justify-center lg:gap-1.5">
          <p className="whitespace-nowrap text-right">
            <span className="text-[22px] font-bold tabular-nums tracking-tight text-[#0f1f1a]">{p.score.toLocaleString("pt-BR")}</span>
            <span className="ml-1 text-[12.5px] text-muted">pontos</span>
          </p>
          <StatusBadge p={p} />
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2 lg:col-span-1 lg:justify-end">
          <Button variant="secondary" size="sm" onClick={onOpen} className="max-lg:grow">
            Ver atividades
          </Button>
          {icp && <IcpControl p={p} busy={icp.busy} onSet={icp.onSet} className="max-lg:grow" />}
          {p.icp !== "no" && <TransformButton p={p} busy={busy} onClick={onTransform} className="max-lg:grow" />}
        </div>
      </div>
    </li>
  );
}

const POST_TYPE: Record<string, string> = { REELS: "no Reel", VIDEO: "no Reel", CAROUSEL_ALBUM: "no carrossel", IMAGE: "na publicação", FEED: "na publicação", STORY: "no Story" };

function describeActivity(a: Activity) {
  switch (a.kind) {
    case "comment": {
      const where = POST_TYPE[a.post?.type ?? ""] ?? "na publicação";
      const cap = a.post?.caption?.trim().split("\n")[0];
      return <>Comentou {where}{cap ? <> “{cap.length > 70 ? `${cap.slice(0, 70)}…` : cap}”</> : null}.</>;
    }
    case "story_reply":
      return <>Respondeu a um Story.</>;
    case "story_mention":
      return <>Mencionou o perfil em um Story.</>;
    case "dm_share":
      return <>Compartilhou uma publicação no Direct.</>;
    default:
      return <>Enviou uma mensagem no Direct.</>;
  }
}

function dayHeader(at: string) {
  const k = dayKey(at);
  if (k === dayKey(new Date())) return "Hoje";
  if (k === dayKey(new Date(Date.now() - 86400_000))) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", weekday: "long", day: "2-digit", month: "long" }).format(new Date(at));
}

function PersonSheet({ personKey, period, kind, onClose, onTransform, busy, icp }: { personKey: string; period: EngagementPeriod; kind: KindFilter; onClose: () => void; onTransform: (p: Person) => void; busy: boolean; icp: ReturnType<typeof useIcp> }) {
  const me = useMe();
  const openContact = useOpenContact();
  const { data, error, isLoading } = useSWR<PersonDetail>(`/api/instagram/engajados/pessoa${qs({ key: personKey, period, kind })}`, fetcher);
  const canOpenContact = !!data?.contactId && (me.permissions.dataAll || data.ownerId === me.user.id);
  let lastDay = "";
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title="Atividades do engajado" width={560}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
        <p className="text-[16px] font-semibold">Perfil do engajado</p>
        <SheetClose asChild>
          <IconButton label="Fechar" size="sm">
            <X className="size-5" />
          </IconButton>
        </SheetClose>
      </div>
      <div className="flex-1 overflow-y-auto scroll-thin px-5 py-5 sm:px-6">
        {error ? (
          <ErrorState error={error} />
        ) : isLoading || !data ? (
          <LoadingState rows={6} />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
              <Avatar name={data.name ?? data.username} src={data.avatarUrl} size={64} />
              <div className="min-w-0">
                <p className="truncate text-[18px] font-semibold">{data.name ?? displayName(data)}</p>
                {data.username && (
                  <a href={`https://www.instagram.com/${data.username}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13.5px] text-brand hover:underline">
                    @{data.username} <ArrowUpRight className="size-3.5" aria-hidden />
                  </a>
                )}
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <StatusBadge p={data} />
                  <IcpBadge p={data} />
                </div>
              </div>
            </div>

            <dl className="grid grid-cols-2 gap-3">
              {[
                { t: "Pontuação", v: `${data.score.toLocaleString("pt-BR")} pontos` },
                { t: "Posição no ranking", v: data.icp === "no" ? "Fora do ranking (não é ICP)" : data.inRanking ? `${data.position}º ${PERIOD_TEXT[period]}` : "Fora do Top 15" },
                { t: "Primeira interação conhecida", v: data.firstAt ? formatDate(data.firstAt) : "—" },
                { t: "Última interação", v: data.lastAt ? relativeTime(data.lastAt) : "—" },
              ].map((x) => (
                <div key={x.t} className="rounded-[16px] bg-page px-3.5 py-3">
                  <dt className="text-[12px] text-muted">{x.t}</dt>
                  <dd className="mt-0.5 text-[14.5px] font-semibold">{x.v}</dd>
                </div>
              ))}
            </dl>

            <div className="flex flex-wrap gap-2">
              {data.canClassifyIcp && <IcpControl p={data} busy={icp.busyKey === data.key} onSet={(v) => icp.set(data, v)} />}
              {data.icp !== "no" && <TransformButton p={data} busy={busy} onClick={() => onTransform(data)} />}
              {canOpenContact && (
                <Button variant="secondary" size="sm" onClick={() => openContact(data.contactId!)}>
                  Ver contato
                </Button>
              )}
            </div>

            <section>
              <h3 className="text-[14px] font-semibold">Resumo do engajamento {PERIOD_TEXT[period]}</h3>
              {data.interactions ? (
                <>
                  <div className="mt-2">
                    <ActionChips counts={data.counts} />
                  </div>
                  {data.capped > 0 && (
                    <p className="mt-2 text-[12.5px] text-muted">
                      {plural(data.capped, "ação repetida passou", "ações repetidas passaram")} do limite diário e não {data.capped === 1 ? "pontuou" : "pontuaram"}.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-1 text-[13px] text-muted">Nenhuma interação deste tipo no período.</p>
              )}
            </section>

            <section>
              <h3 className="text-[14px] font-semibold">Histórico de atividades</h3>
              {data.activities.length === 0 ? (
                <p className="mt-1 text-[13px] text-muted">Sem atividades no período selecionado.</p>
              ) : (
                <ol className="mt-1">
                  {data.activities.map((a) => {
                    const day = dayHeader(a.at);
                    const header = day !== lastDay ? ((lastDay = day), day) : null;
                    return (
                      <li key={a.id}>
                        {header && <p className="mt-4 mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted first-letter:uppercase">{header}</p>}
                        <div className="flex gap-3 border-b border-line py-3 last:border-0">
                          <span className="w-11 shrink-0 pt-0.5 text-[13px] font-semibold tabular-nums">{formatTime(a.at)}</span>
                          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-selected text-brand [&>svg]:size-3.5" aria-hidden>
                            {KIND_ICON[a.kind]}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[14px]">{describeActivity(a)}</p>
                            {a.text && <p className="mt-0.5 line-clamp-3 text-[13px] text-muted">“{a.text}”</p>}
                            {a.restricted && a.kind !== "comment" && <p className="mt-0.5 text-[12.5px] text-muted">Conteúdo visível só para quem cuida desta conversa.</p>}
                            {a.excluded && <p className="mt-1 text-[12px] font-medium text-warning">Não pontua · {a.excludedReason}</p>}
                            {(a.link || a.externalUrl) && (
                              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] font-medium">
                                {a.link && (
                                  <Link href={a.link} className="text-brand hover:underline">
                                    {a.kind === "comment" ? "Abrir comentário" : "Abrir conversa"}
                                  </Link>
                                )}
                                {a.externalUrl && (
                                  <a href={a.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
                                    {a.externalLabel} <ExternalLink className="size-3.5" aria-hidden />
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        )}
      </div>
    </Sheet>
  );
}

type Config = { weights: Record<string, number>; dailyCap: number; closersCanView: boolean; updatedAt: string | null; updatedByName: string | null };

/** Como o score funciona (todos) e, para o administrador, a edição de pesos e critérios. */
function ScoreDialog({ open, onOpenChange, ranking, onSaved }: { open: boolean; onOpenChange: (v: boolean) => void; ranking: Ranking; onSaved: () => void }) {
  const admin = ranking.canConfigure;
  const { data: cfg } = useSWR<Config>(open && admin ? "/api/instagram/engajados/config" : null, fetcher);
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [cap, setCap] = useState("");
  const [closers, setClosers] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const src = cfg ?? { weights: ranking.weights, dailyCap: ranking.dailyCap, closersCanView: false };
    setWeights(Object.fromEntries(TRACKED_KINDS.map((k) => [k, String(src.weights[k] ?? ENGAGEMENT_ACTIONS[k].defaultWeight)])));
    setCap(String(src.dailyCap));
    setClosers(src.closersCanView);
  }, [cfg, ranking.weights, ranking.dailyCap, open]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/api/instagram/engajados/config", {
        weights: Object.fromEntries(TRACKED_KINDS.map((k) => [k, Math.max(0, Math.round(Number(weights[k]) || 0))])),
        dailyCap: Math.max(1, Math.round(Number(cap) || 1)),
        closersCanView: closers,
      });
      toast.success("Pontuação atualizada. O ranking já usa os novos pesos.");
      onSaved();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title={admin ? "Pontuação do engajamento" : "Como o score é calculado"}
      description="Só entram ações que a API oficial da Meta atribui a uma pessoa."
      footer={
        admin ? (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} disabled={busy}>
              Salvar pesos
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="text-[14px] font-semibold">Ações pontuadas</h3>
          <ul className="mt-2 divide-y divide-line rounded-[16px] border border-line">
            {TRACKED_KINDS.map((k) => (
              <li key={k} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected text-brand [&>svg]:size-4" aria-hidden>
                  {KIND_ICON[k]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium">{ENGAGEMENT_ACTIONS[k].label}</p>
                  <p className="text-[12px] text-muted">{ENGAGEMENT_ACTIONS[k].how}</p>
                </div>
                {admin ? (
                  <Input aria-label={`Pontos por ${ENGAGEMENT_ACTIONS[k].label}`} type="number" min={0} max={100} inputMode="numeric" value={weights[k] ?? ""} onChange={(e) => setWeights((w) => ({ ...w, [k]: e.target.value }))} className="w-20 text-right" />
                ) : (
                  <span className="text-[14px] font-semibold tabular-nums">+{ranking.weights[k]}</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-[14px] font-semibold">Anti-spam</h3>
          {admin ? (
            <label className="mt-2 flex items-center justify-between gap-3 rounded-[16px] border border-line px-3.5 py-2.5">
              <span className="text-[13.5px]">Cada tipo de ação pontua no máximo esta quantidade de vezes por pessoa, por dia</span>
              <Input aria-label="Limite diário por tipo de ação" type="number" min={1} max={50} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} className="w-20 text-right" />
            </label>
          ) : (
            <p className="mt-1 text-[13.5px] text-muted">Cada tipo de ação pontua no máximo {ranking.dailyCap} vezes por pessoa, por dia. Comentários ocultos ou excluídos pela conta e mensagens apagadas pelo remetente não pontuam.</p>
          )}
          {admin && <p className="mt-1.5 text-[12.5px] text-muted">Comentários ocultos ou excluídos pela conta e mensagens apagadas pelo remetente nunca pontuam.</p>}
        </section>

        <section>
          <h3 className="text-[14px] font-semibold">Fora do score (a API não identifica quem fez)</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {UNTRACKED_KINDS.map((k) => (
              <li key={k} className="flex gap-2 text-[13px]">
                <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                <span>
                  <b className="font-medium">{ENGAGEMENT_ACTIONS[k].label}</b> <span className="text-muted">— {ENGAGEMENT_ACTIONS[k].how}</span>
                </span>
              </li>
            ))}
            {API_LIMITATIONS.map((t) => (
              <li key={t} className="flex gap-2 text-[13px] text-muted">
                <CircleSlash className="mt-0.5 size-4 shrink-0" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </section>

        {admin && (
          <section className="rounded-[16px] border border-line px-3.5 py-3">
            <Switch checked={closers} onChange={setClosers} label="Closers podem ver o Top Engajados" description="Desligado por padrão. Social sellers, gestores e administradores sempre veem." />
            {cfg?.updatedAt && (
              <p className="mt-2 text-[12px] text-muted">
                Alterado {relativeTime(cfg.updatedAt).toLowerCase()}
                {cfg.updatedByName ? ` por ${cfg.updatedByName}` : ""}.
              </p>
            )}
          </section>
        )}
      </div>
    </Dialog>
  );
}

/** Instagram → Top Engajados: as 15 pessoas que mais interagem, só com interações identificáveis pela API. */
export function TopEngagedView({ connected }: { connected: boolean | null }) {
  const [period, setPeriod] = useState<EngagementPeriod>("week");
  const [kind, setKind] = useState<KindFilter>("all");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [scoreOpen, setScoreOpen] = useState(false);
  const [outOfIcp, setOutOfIcp] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const key = `/api/instagram/engajados${qs({ period, kind, q: term || undefined, icp: outOfIcp ? "out" : undefined })}`;
  const { data, error, isLoading, mutate } = useSWR<Ranking>(key, fetcher, { refreshInterval: 60_000, keepPreviousData: true });
  const transform = useTransform(() => mutate());
  const openPerson = useMemo(() => data?.rows.find((p) => p.key === open) ?? null, [data, open]);
  const icp = useIcp();
  useEffect(() => {
    if (outOfIcp && data && !data.totals.outOfIcp && !isLoading) setOutOfIcp(false);
  }, [outOfIcp, data, isLoading]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={period} onChange={setPeriod} items={PERIOD_ITEMS} className="self-start" />
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label="Tipo de interação" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)} className="w-auto min-w-0 grow bg-white sm:grow-0">
            {KIND_FILTERS.map((k) => (
              <option key={k} value={k}>
                {KIND_FILTER_LABEL[k]}
              </option>
            ))}
          </Select>
          <div className="min-w-0 grow sm:w-64 sm:grow-0">
            <Input aria-label="Pesquisar por nome ou @" placeholder="Nome ou @username" icon={<Search className="size-4" />} value={q} onChange={(e) => setQ(e.target.value)} className="bg-white" />
          </div>
          {data && (
            <Button variant="secondary" size="sm" className="h-11" icon={data.canConfigure ? <Settings2 className="size-4" /> : <Info className="size-4" />} onClick={() => setScoreOpen(true)}>
              {data.canConfigure ? "Pontuação" : "Como funciona"}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <Card>
          <ErrorState error={error} onRetry={() => mutate()} />
        </Card>
      ) : isLoading && !data ? (
        <LoadingState rows={6} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Kpi i={0} icon={<Users />} label="Pessoas engajadas" value={data.totals.people} sub={`Pessoas identificadas ${PERIOD_TEXT[period]}`} />
            <Kpi i={1} icon={<Sparkles />} label="Interações identificadas" value={data.totals.interactions} sub="Ações individuais registradas" />
            <Kpi i={2} icon={<MessageCircle />} label="Comentários" value={data.totals.comments} sub="Em publicações da conta" />
            <Kpi i={3} icon={<Send />} label="Directs recebidos" value={data.totals.directs} sub="Mensagens, Stories e compartilhamentos" />
            <Kpi i={4} icon={<Trophy />} label="Potenciais oportunidades" value={data.totals.opportunities} sub="Do Top 15 que ainda não são Leads" />
          </div>

          {outOfIcp && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px] text-ink">
                <span className="font-semibold">{plural(data.totals.outOfIcp, "pessoa marcada", "pessoas marcadas")} como fora do ICP</span>
                <span className="text-muted"> · não entram no Top 15 em nenhum período</span>
              </p>
              <Button variant="secondary" size="sm" icon={<ArrowLeft className="size-4" />} onClick={() => setOutOfIcp(false)}>
                Voltar ao Top 15
              </Button>
            </div>
          )}
          <Card className="overflow-hidden">
            {data.rows.length === 0 ? (
              <EmptyState
                icon={<Trophy />}
                title={term ? "Ninguém encontrado" : `Nenhuma interação identificada ${PERIOD_TEXT[period]}`}
                description={
                  term
                    ? "A busca procura entre as pessoas que interagiram no período e no filtro escolhidos."
                    : connected === false
                      ? "Conecte o Instagram em Configurações para começar a identificar quem interage."
                      : "Comentários, Directs, respostas e menções em Stories aparecem aqui assim que chegam pela API oficial."
                }
              />
            ) : (
              <ol aria-label="Top 15 engajados">
                {data.rows.map((p) => (
                  <RankRow
                    key={p.key}
                    p={p}
                    onOpen={() => setOpen(p.key)}
                    onTransform={() => transform.start(p)}
                    busy={transform.busyKey === p.key}
                    icp={data.canClassifyIcp ? { busy: icp.busyKey === p.key, onSet: (v) => icp.set(p, v) } : null}
                  />
                ))}
              </ol>
            )}
          </Card>
          {!outOfIcp && data.totals.outOfIcp > 0 && (
            <button type="button" onClick={() => setOutOfIcp(true)} className="self-start text-[13px] font-medium text-brand hover:underline">
              {plural(data.totals.outOfIcp, "pessoa fora do ICP", "pessoas fora do ICP")} não {data.totals.outOfIcp === 1 ? "aparece" : "aparecem"} no ranking · Ver
            </button>
          )}
          <p className="text-[12.5px] text-muted">
            Ranking com base apenas em ações que a API oficial atribui a uma pessoa. Engajamento não é intenção de compra: ninguém entra no Kanban sem a confirmação do Social Seller.
          </p>
          <ScoreDialog open={scoreOpen} onOpenChange={setScoreOpen} ranking={data} onSaved={() => mutate()} />
        </>
      ) : null}

      {open && <PersonSheet personKey={open} period={period} kind={kind} onClose={() => setOpen(null)} onTransform={(p) => transform.start(openPerson ?? p)} busy={transform.busyKey === open} icp={icp} />}
      {transform.dialog}
    </div>
  );
}
