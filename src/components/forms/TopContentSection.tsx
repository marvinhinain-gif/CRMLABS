"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import useSWR from "swr";
import { CircleAlert, ExternalLink, Flame, Heart, ImageOff, Info, MessageCircle, MessageSquareQuote, Plus, RefreshCw, Search, Tag } from "lucide-react";
import { fetcher } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, cx, EmptyState, ErrorState, Input } from "@/components/ui";
import { ContentThumb, KindIcon, type ContentType } from "./ContentPicker";

// Formatos de GET /api/forms/top-content (src/server/services/topContent.ts).
type TrackedRef = { formId: string; formName: string; key: string; label: string };
type FeedItem = {
  externalId: string;
  mediaType: string | null;
  caption: string | null;
  permalink: string | null;
  previewUrl: string | null;
  postedAt: string | null;
  likes: number;
  comments: number;
  keywordComments: number;
  matchedIn: ("legenda" | "comentarios")[];
  score: number;
  tracked: TrackedRef[];
};
type TopFeed = { connected: boolean; username: string | null; error?: string; keyword: string; scanned: number; items: FeedItem[] };
type StoryItem = { id: string; externalId: string | null; imageUrl: string | null; postedAt: string | null; replies: number; keywordReplies: number; samples: string[]; saved: boolean; tracked: TrackedRef[] };
type TopStories = { items: StoryItem[]; savedCount: number };

const DEFAULT_KEYWORD = "mentoria";
const n = (v: number) => v.toLocaleString("pt-BR");
const plural = (v: number, one: string, many: string) => `${n(v)} ${v === 1 ? one : many}`;

/** Minúsculas e sem acento, letra a letra (mantém as posições para destacar o trecho original). */
const foldChar = (c: string) => c.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Destaca a palavra-chave no texto, sem ligar para maiúsculas e acentos. */
function Highlight({ text, q }: { text: string; q: string }) {
  const needle = Array.from(q.trim()).map(foldChar).join("");
  if (!needle) return <>{text}</>;
  const chars = Array.from(text);
  const folded: string[] = [];
  const owner: number[] = []; // posição do caractere original de cada letra "dobrada"
  chars.forEach((c, i) => {
    for (const f of foldChar(c)) {
      folded.push(f);
      owner.push(i);
    }
  });
  const hay = folded.join("");
  const parts: ReactNode[] = [];
  let from = 0;
  let at = hay.indexOf(needle);
  while (at !== -1) {
    const s = owner[at];
    const e = owner[at + needle.length - 1] + 1;
    if (s > from) parts.push(chars.slice(from, s).join(""));
    parts.push(
      <mark key={s} className="rounded-[4px] bg-[#fff1b8] font-semibold text-ink">
        {chars.slice(s, e).join("")}
      </mark>,
    );
    from = e;
    at = hay.indexOf(needle, at + needle.length);
  }
  if (from < chars.length) parts.push(chars.slice(from).join(""));
  return <>{parts}</>;
}

/** Foto que pode ter expirado (links do Instagram vencem): vira um bloco "Imagem expirada". */
function ExpiringImage({ kind, src, alt }: { kind: ContentType; src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const ratio = kind === "stories" ? "aspect-[9/16]" : "aspect-[4/5]";
  if (!src) return <ContentThumb kind={kind} imageUrl={null} />;
  if (broken) {
    return (
      <div className={cx("flex w-full flex-col items-center justify-center gap-1.5 rounded-[14px] border border-dashed border-line bg-page p-2 text-center text-muted", ratio)}>
        <ImageOff className="size-6" aria-hidden />
        <span className="text-[11.5px] font-medium leading-tight">Imagem expirada</span>
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className={cx("block w-full rounded-[14px] border border-line bg-page object-cover", ratio)} />;
}

function TrackedChips({ tracked }: { tracked: TrackedRef[] }) {
  if (!tracked.length) return null;
  const forms = [...new Map(tracked.map((t) => [t.formId, t])).values()];
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {forms.map((t) => (
        <Link key={t.formId} href={`/formularios/${t.formId}/respostas?link=${encodeURIComponent(t.key)}`} className="min-w-0 max-w-full">
          <Badge tone="success" className="max-w-full">
            <Tag className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">Rastreado em {t.formName}</span>
          </Badge>
        </Link>
      ))}
    </div>
  );
}

const linkBtn = "inline-flex h-10 items-center justify-center gap-2 rounded-[12px] border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-page";

/** "Conteúdos com mais interação": posts e Stories antigos que citam a palavra-chave, do mais forte para o mais fraco. */
export function TopContentSection({ onTrack }: { onTrack: (type: ContentType, externalId: string) => void }) {
  const [type, setType] = useState<ContentType>("feed");
  const [text, setText] = useState(DEFAULT_KEYWORD);
  const [q, setQ] = useState(DEFAULT_KEYWORD);
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim().slice(0, 40)), 400);
    return () => clearTimeout(t);
  }, [text]);
  const keyword = q || DEFAULT_KEYWORD;

  return (
    <section className="flex flex-col gap-3 sm:gap-4" aria-labelledby="top-content-title">
      <div className="flex flex-col gap-1">
        <h2 id="top-content-title" className="flex items-center gap-2 text-[17px] font-bold text-ink sm:text-[18px]">
          <Flame className="size-5 text-brand" aria-hidden /> Conteúdos com mais interação
        </h2>
        <p className="text-[13.5px] text-muted sm:text-[14px]">Posts e Stories antigos que falaram da palavra-chave, do que mais engajou para o que menos engajou.</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <label className="min-w-0 sm:w-72">
          <span className="sr-only">Palavra-chave</span>
          <Input icon={<Search className="size-4" />} value={text} maxLength={40} placeholder="Palavra-chave, ex.: mentoria" onChange={(e) => setText(e.target.value)} />
        </label>
        <div role="radiogroup" aria-label="Tipo de conteúdo" className="inline-flex w-full rounded-[14px] bg-page p-1 sm:w-auto">
          {(
            [
              ["feed", "Posts do feed"],
              ["stories", "Stories"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={type === v}
              onClick={() => setType(v)}
              className={cx("flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-medium transition-colors sm:flex-none sm:px-4", type === v ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")}
            >
              <KindIcon kind={v} className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {type === "feed" ? <FeedList q={keyword} onTrack={(id) => onTrack("feed", id)} /> : <StoriesList q={keyword} onTrack={(id) => onTrack("stories", id)} />}
    </section>
  );
}

function ListSkeleton({ kind }: { kind: ContentType }) {
  return (
    <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-busy="true" aria-label="Carregando conteúdos">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i} className="flex gap-3 rounded-[20px] border border-line bg-white p-4">
          <div className={cx("skeleton w-[88px] shrink-0 rounded-[14px] sm:w-[104px]", kind === "stories" ? "aspect-[9/16]" : "aspect-[4/5]")} />
          <div className="flex flex-1 flex-col gap-2">
            <div className="skeleton h-4 w-1/3" />
            <div className="skeleton h-4 w-full" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-[14px] bg-page px-3 py-2.5 text-[13px] text-ink">
      <Info className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  );
}

// ---------- Posts do feed ----------

function FeedList({ q, onTrack }: { q: string; onTrack: (externalId: string) => void }) {
  const key = `/api/forms/top-content?type=feed&q=${encodeURIComponent(q)}`;
  const { data, error, isLoading, isValidating, mutate } = useSWR<TopFeed>(key, fetcher, { keepPreviousData: true, revalidateOnFocus: false });
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await mutate(fetcher<TopFeed>(`${key}&refresh=1`), { revalidate: false });
    } catch {
      // O erro aparece no próprio quadro.
    } finally {
      setRefreshing(false);
    }
  };

  const refreshBtn = (
    <Button size="sm" variant="secondary" icon={<RefreshCw className={cx("size-4", refreshing && "animate-spin")} />} disabled={refreshing} onClick={refresh}>
      Atualizar do Instagram
    </Button>
  );

  if (error && !data) {
    return (
      <Card className="p-4 sm:p-6">
        <ErrorState error={error} onRetry={() => mutate()} />
      </Card>
    );
  }
  if (isLoading && !data) return <ListSkeleton kind="feed" />;
  if (!data) return null;

  if (!data.connected) {
    return (
      <Card className="p-4 sm:p-6">
        <EmptyState
          icon={<CircleAlert />}
          title="Instagram não conectado"
          description={data.error ?? "Conecte o Instagram para ver quais posts tiveram mais curtidas e comentários."}
          action={
            <Link href="/integracoes" className="inline-flex h-11 items-center rounded-[14px] bg-brand px-4 text-[14px] font-semibold text-white">
              Ir para Integrações
            </Link>
          }
        />
      </Card>
    );
  }

  const stale = (isValidating && !refreshing) || refreshing;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted">
          Interação = curtidas + comentários{data.username ? ` em @${data.username}` : ""}. Os números ficam guardados por 10 minutos.
        </p>
        <div className="max-sm:[&>*]:w-full">{refreshBtn}</div>
      </div>
      {data.error ? (
        <Card className="p-4 sm:p-6">
          <EmptyState icon={<CircleAlert />} title="Não deu para buscar agora" description={data.error} action={refreshBtn} />
        </Card>
      ) : !data.items.length ? (
        <Card className="p-4 sm:p-6">
          <EmptyState
            icon={<Search />}
            title={`Nenhum post com “${data.keyword}”`}
            description={`Procuramos nas legendas e nos comentários dos últimos ${plural(data.scanned, "post", "posts")}. Tente outra palavra.`}
          />
        </Card>
      ) : (
        <>
          <ul className={cx("grid grid-cols-[minmax(0,1fr)] gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3", stale && "opacity-60")}>
            {data.items.map((it, i) => (
              <FeedCard key={it.externalId} it={it} rank={i + 1} q={data.keyword} onTrack={() => onTrack(it.externalId)} />
            ))}
          </ul>
          <p className="text-center text-[12.5px] text-muted">
            Analisamos os últimos {plural(data.scanned, "post", "posts")} · {plural(data.items.length, "citou", "citaram")} “{data.keyword}”
          </p>
        </>
      )}
    </div>
  );
}

function FeedCard({ it, rank, q, onTrack }: { it: FeedItem; rank: number; q: string; onTrack: () => void }) {
  const where = it.matchedIn.map((m) => (m === "legenda" ? "na legenda" : "nos comentários")).join(" e ");
  return (
    <li className="min-w-0">
      <Card as="article" className="flex h-full flex-col gap-3 p-4">
        <div className="flex min-w-0 gap-3 sm:gap-4">
          <div className="relative w-[88px] shrink-0 sm:w-[104px]">
            <ExpiringImage kind="feed" src={it.previewUrl} alt={it.caption?.slice(0, 80) ?? "Post do feed"} />
            <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[11.5px] font-bold text-ink shadow-sm">#{rank}</span>
            {it.mediaType === "VIDEO" && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10.5px] font-medium text-white">Vídeo</span>}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="info">
                <KindIcon kind="feed" className="size-3.5" />
                Post
              </Badge>
              {it.postedAt && <span className="text-[12px] text-muted">{formatDate(it.postedAt)}</span>}
            </div>
            <p className="line-clamp-2 break-words text-[14px] leading-snug text-ink">{it.caption ? <Highlight text={it.caption} q={q} /> : <span className="text-muted">Sem legenda</span>}</p>
            {where && <p className="text-[12px] text-muted">Citou “{q}” {where}</p>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-page px-2 py-2 text-center">
          <Stat icon={<Heart className="size-3.5" />} value={it.likes} label="curtidas" />
          <Stat icon={<MessageCircle className="size-3.5" />} value={it.comments} label="comentários" />
          <Stat icon={<Search className="size-3.5" />} value={it.keywordComments} label="com a palavra" strong />
        </div>
        <TrackedChips tracked={it.tracked} />
        <div className="mt-auto flex flex-wrap gap-2 max-sm:[&>*]:grow">
          {it.permalink && (
            <a href={it.permalink} target="_blank" rel="noopener noreferrer" className={linkBtn}>
              <ExternalLink className="size-4" aria-hidden /> Ver no Instagram
            </a>
          )}
          <Button size="sm" variant={it.tracked.length ? "secondary" : "primary"} className="h-10" icon={<Plus className="size-4" />} onClick={onTrack}>
            {it.tracked.length ? "Rastrear de novo" : "Rastrear este post"}
          </Button>
        </div>
      </Card>
    </li>
  );
}

function Stat({ icon, value, label, strong }: { icon: ReactNode; value: number; label: string; strong?: boolean }) {
  return (
    <span className="min-w-0">
      <span className={cx("flex items-center justify-center gap-1 font-bold leading-tight", strong ? "text-[17px] text-brand" : "text-[16px] text-ink")}>
        <span className="text-muted" aria-hidden>
          {icon}
        </span>
        {n(value)}
      </span>
      <span className="block truncate text-[11.5px] text-muted">{label}</span>
    </span>
  );
}

// ---------- Stories ----------

function StoriesList({ q, onTrack }: { q: string; onTrack: (externalId: string) => void }) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<TopStories>(`/api/forms/top-content?type=stories&q=${encodeURIComponent(q)}`, fetcher, { keepPreviousData: true, revalidateOnFocus: false });

  const info = <Notice>O Instagram só guarda stories por 24 horas. Os antigos aparecem pelas respostas que chegaram no Direct; a partir de agora o CRM guarda cada story novo.</Notice>;

  if (error && !data) {
    return (
      <Card className="p-4 sm:p-6">
        <ErrorState error={error} onRetry={() => mutate()} />
      </Card>
    );
  }
  if (isLoading && !data) return <ListSkeleton kind="stories" />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-3">
      {info}
      {!data.items.length ? (
        <Card className="p-4 sm:p-6">
          <EmptyState icon={<MessageSquareQuote />} title={`Nenhum Stories com “${q}”`} description="Nenhuma resposta no Direct citou essa palavra no último ano. Tente outra palavra." />
        </Card>
      ) : (
        <ul className={cx("grid grid-cols-[minmax(0,1fr)] gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3", isValidating && "opacity-60")}>
          {data.items.map((it, i) => (
            <StoryCard key={it.id} it={it} rank={i + 1} q={q} onTrack={it.saved && it.externalId ? () => onTrack(it.externalId!) : undefined} />
          ))}
        </ul>
      )}
      <p className="text-center text-[12.5px] text-muted">{data.savedCount ? `${plural(data.savedCount, "Stories guardado", "Stories guardados")} no CRM até agora` : "Nenhum Stories guardado no CRM ainda"}</p>
    </div>
  );
}

function StoryCard({ it, rank, q, onTrack }: { it: StoryItem; rank: number; q: string; onTrack?: () => void }) {
  return (
    <li className="min-w-0">
      <Card as="article" className="flex h-full flex-col gap-3 p-4">
        <div className="flex min-w-0 gap-3 sm:gap-4">
          <div className="relative w-[88px] shrink-0 sm:w-[104px]">
            <ExpiringImage kind="stories" src={it.imageUrl} alt="Stories" />
            <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[11.5px] font-bold text-ink shadow-sm">#{rank}</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone="brand">
                <KindIcon kind="stories" className="size-3.5" />
                Stories
              </Badge>
              {it.saved ? <Badge tone="success">Guardado</Badge> : <Badge>Antigo</Badge>}
              {it.postedAt && <span className="text-[12px] text-muted">{formatDate(it.postedAt)}</span>}
            </div>
            <p className="text-[13.5px] text-ink">
              <b>{plural(it.replies, "resposta", "respostas")}</b> no Direct · <b className="text-brand">{n(it.keywordReplies)} com a palavra</b>
            </p>
            {it.samples.length > 0 && (
              <ul className="flex flex-col gap-1">
                {it.samples.slice(0, 3).map((s, i) => (
                  <li key={i} className="line-clamp-2 break-words rounded-[10px] bg-page px-2 py-1 text-[12.5px] italic leading-snug text-ink">
                    “<Highlight text={s} q={q} />”
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <TrackedChips tracked={it.tracked} />
        {onTrack ? (
          <div className="mt-auto flex flex-wrap gap-2 max-sm:[&>*]:grow">
            <Button size="sm" variant={it.tracked.length ? "secondary" : "primary"} className="h-10" icon={<Plus className="size-4" />} onClick={onTrack}>
              {it.tracked.length ? "Rastrear de novo" : "Rastrear"}
            </Button>
          </div>
        ) : !it.saved ? (
          <p className="mt-auto text-[12px] text-muted">Stories antigo: dá para ver as respostas, mas não para rastrear.</p>
        ) : null}
      </Card>
    </li>
  );
}
