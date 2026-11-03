"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowRight, Check, Copy, ExternalLink, Inbox, Link2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { useQueryParam } from "@/lib/nav";
import { formatDate, relativeTime, TZ } from "@/lib/format";
import { LINK_KIND_LABEL, type LinkKind, type SourceLink } from "@/lib/quiz/types";
import { Button, Card, cx, Dialog, EmptyState, ErrorState, Field, Input, LoadingState, Select } from "@/components/ui";
import { ContentPicker, ContentThumb, KindBadge, KindIcon, stripImageUrl, type LinkContentWithImage } from "./ContentPicker";
import { copyText, CopyField, Kpi, pct, type FormListItem } from "./shared";

type TrackedKind = "stories" | "feed" | "bio";
type ReportRow = {
  formId: string;
  formName: string;
  key: string;
  label: string;
  kind: LinkKind;
  url: string;
  content: LinkContentWithImage | null;
  views: number;
  starts: number;
  signups: number;
  qualified: number;
  lastSignupAt: string | null;
};
type Report = { days: number | "all"; rows: ReportRow[]; totals: { kind: TrackedKind | "other"; signups: number }[]; totalSignups: number };

const TOTAL_LABEL: Record<TrackedKind | "other", string> = { stories: "Stories", feed: "Post do feed", bio: "Link da bio", other: "Outras origens" };
const n = (v: number) => v.toLocaleString("pt-BR");

/** Aba "Conteúdos": qual Stories, post ou link da bio trouxe cada cadastro. */
export function ContentTrackingView() {
  const [days, setDays] = useQueryParam("periodo", "30");
  const { data, error, isLoading, mutate } = useSWR<Report>(`/api/forms/content-report?days=${days}`, fetcher, { keepPreviousData: true });
  const [tracking, setTracking] = useState(false);

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14.5px] text-ink sm:text-[15px]">Veja qual Stories, post do feed ou link da bio trouxe cada cadastro.</p>
        <div className="flex gap-2 max-sm:[&>*]:grow">
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Período" className="sm:w-36">
            <option value="7">7 dias</option>
            <option value="30">30 dias</option>
            <option value="90">90 dias</option>
            <option value="all">Tudo</option>
          </Select>
          <Button icon={<Plus className="size-5" />} onClick={() => setTracking(true)}>
            Rastrear conteúdo
          </Button>
        </div>
      </div>

      {error ? (
        <Card className="p-4 sm:p-6">
          <ErrorState error={error} onRetry={() => mutate()} />
        </Card>
      ) : isLoading && !data ? (
        <LoadingState rows={4} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            {data.totals.map((t, i) => (
              <Kpi
                key={t.kind}
                i={i}
                icon={t.kind === "other" ? <Link2 /> : <KindIcon kind={t.kind} />}
                label={TOTAL_LABEL[t.kind]}
                value={n(t.signups)}
                sub={data.totalSignups ? `${pct(t.signups / data.totalSignups)} dos cadastros` : "cadastros"}
              />
            ))}
          </div>
          {data.rows.length ? (
            <ul className={cx("grid grid-cols-[minmax(0,1fr)] gap-3 sm:gap-4 md:grid-cols-2 2xl:grid-cols-3", isLoading && "opacity-60")}>
              {data.rows.map((r, i) => (
                <ContentCard key={`${r.formId}:${r.key}`} r={r} rank={i + 1} />
              ))}
            </ul>
          ) : (
            <Card className="p-4 sm:p-6">
              <HowItWorks onStart={() => setTracking(true)} />
            </Card>
          )}
        </>
      ) : null}

      <TrackDialog open={tracking} onOpenChange={setTracking} onCreated={() => mutate()} />
    </div>
  );
}

function HowItWorks({ onStart }: { onStart: () => void }) {
  const steps = [
    ["Escolha o conteúdo", "O Stories, o post do feed ou a bio onde você vai divulgar o formulário."],
    ["Copie o link", "Cada conteúdo ganha um link só dele."],
    ["Coloque no Instagram", "No sticker de link do Stories, na bio ou na automação do post (comentário ou Direct)."],
  ] as const;
  return (
    <EmptyState
      icon={<Sparkles />}
      title="Nenhum conteúdo rastreado ainda"
      description="Descubra qual conteúdo traz mais cadastros em 3 passos:"
      action={
        <div className="flex flex-col items-center gap-4">
          <ol className="grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-3 text-left sm:grid-cols-3">
            {steps.map(([t, d], i) => (
              <li key={t} className="flex gap-3 rounded-[16px] border border-line p-3 sm:flex-col sm:gap-2">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-selected text-[14px] font-bold text-brand">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-ink">{t}</span>
                  <span className="block text-[13px] text-muted">{d}</span>
                </span>
              </li>
            ))}
          </ol>
          <Button icon={<Plus className="size-5" />} onClick={onStart}>
            Rastrear conteúdo
          </Button>
        </div>
      }
    />
  );
}

function ContentCard({ r, rank }: { r: ReportRow; rank: number }) {
  const conv = r.views ? pct(Math.min(1, r.signups / r.views)) : "—";
  return (
    <li className="min-w-0">
      <Card as="article" className="flex h-full flex-col gap-3 p-4">
        <div className="flex min-w-0 gap-3 sm:gap-4">
          <div className="relative w-[88px] shrink-0 sm:w-[104px]">
            <ContentThumb kind={r.kind} imageUrl={r.content?.imageUrl} alt={r.label} />
            <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-1.5 py-0.5 text-[11.5px] font-bold text-ink shadow-sm">#{rank}</span>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-wrap items-center gap-1.5">
              <KindBadge kind={r.kind} />
              {r.content?.postedAt && <span className="text-[12px] text-muted">{formatDate(r.content.postedAt)}</span>}
            </div>
            <h3 className="mt-1.5 line-clamp-2 break-words text-[15px] font-semibold leading-snug text-ink">{r.label}</h3>
            {r.content?.caption && <p className="mt-0.5 line-clamp-2 break-words text-[13px] text-muted">{r.content.caption}</p>}
            <p className="mt-auto truncate pt-1.5 text-[12px] text-muted">
              {r.formName}
              {r.lastSignupAt ? ` · último cadastro ${relativeTime(r.lastSignupAt).toLowerCase()}` : ""}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 rounded-[14px] bg-page px-2 py-2 text-center">
          <Metric label="Visitas" value={r.views} />
          <ArrowRight className="size-3.5 text-muted" aria-hidden />
          <Metric label="Cadastros" value={r.signups} strong />
          <ArrowRight className="size-3.5 text-muted" aria-hidden />
          <Metric label="Qualificados" value={r.qualified} />
        </div>
        <p className="-mt-1 text-[12.5px] text-muted">
          Conversão: <b className="text-ink">{conv}</b> das visitas viraram cadastro
        </p>
        <div className="flex flex-wrap gap-2 max-sm:[&>*]:grow">
          <Button size="sm" variant="secondary" icon={<Copy className="size-4" />} onClick={() => copyText(r.url, "Link copiado")}>
            Copiar link
          </Button>
          {r.content?.permalink && (
            <a href={r.content.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center justify-center gap-2 rounded-[12px] border border-line bg-white px-3 text-[13px] font-medium text-ink hover:bg-page">
              <ExternalLink className="size-4" aria-hidden /> Ver no Instagram
            </a>
          )}
          <Link href={`/formularios/${r.formId}/respostas?link=${encodeURIComponent(r.key)}`} className="inline-flex h-9 items-center justify-center gap-2 rounded-[12px] bg-selected px-3 text-[13px] font-medium text-brand hover:brightness-[0.97]">
            <Inbox className="size-4" aria-hidden /> Ver cadastros
          </Link>
        </div>
      </Card>
    </li>
  );
}

function Metric({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <span className="min-w-0">
      <span className={cx("block truncate font-bold leading-tight", strong ? "text-[20px] text-brand" : "text-[17px] text-ink")}>{n(value)}</span>
      <span className="block truncate text-[11.5px] text-muted">{label}</span>
    </span>
  );
}

// ---------- Diálogo "Rastrear conteúdo" ----------

const TYPE_CHOICES: { kind: TrackedKind; title: string; description: string }[] = [
  { kind: "stories", title: "Stories", description: "Link no sticker" },
  { kind: "feed", title: "Post do feed", description: "Automação ou Direct" },
  { kind: "bio", title: "Link da bio", description: "Link do perfil" },
];

const INSTRUCTION: Record<TrackedKind, string> = {
  stories: "Cole este link no sticker de link do Stories.",
  bio: "Cole este link na bio do Instagram (Editar perfil → Links).",
  feed: "Post do feed não tem link clicável. Use este link na automação de comentário ou Direct (ex.: ManyChat) ou no botão Enviar formulário do CRM.",
};

const shortDate = (iso: string | null) => {
  const d = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" }).format(d);
};
const captionStart = (c: string | null | undefined, max = 40) => {
  const t = (c ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 15 ? cut.lastIndexOf(" ") : max).trim()}…`;
};
export function autoLabel(kind: TrackedKind, c: LinkContentWithImage | null) {
  if (kind === "bio") return "Link da bio";
  const cap = captionStart(c?.caption);
  if (kind === "stories") return `Stories ${shortDate(c?.postedAt ?? null)}${cap ? ` · ${cap}` : ""}`;
  return cap ? `Post: ${cap}` : `Post do feed ${shortDate(c?.postedAt ?? null)}`;
}

type Created = { link: SourceLink & { url: string }; live: boolean };

function TrackDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const { data: forms, error: formsError, mutate: refreshForms } = useSWR<FormListItem[]>(open ? "/api/forms?status=active" : null, fetcher);
  const [kind, setKind] = useState<TrackedKind>("stories");
  const [formId, setFormId] = useState("");
  const [content, setContent] = useState<LinkContentWithImage | null>(null);
  const [label, setLabel] = useState(autoLabel("stories", null));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [created, setCreated] = useState<Created | null>(null);

  // Formulário padrão: o mais recente no ar.
  const sorted = useMemo(() => [...(forms ?? [])].sort((a, b) => Number(b.live) - Number(a.live) || (b.publishedAt ?? b.createdAt).localeCompare(a.publishedAt ?? a.createdAt)), [forms]);
  useEffect(() => {
    if (!formId && sorted.length) setFormId(sorted[0].id);
  }, [sorted, formId]);

  const reset = () => {
    setKind("stories");
    setContent(null);
    setLabel(autoLabel("stories", null));
    setTouched(false);
    setErr(undefined);
    setCreated(null);
  };
  const close = (v: boolean) => {
    onOpenChange(v);
    if (!v) setTimeout(reset, 200);
  };
  const chooseKind = (k: TrackedKind) => {
    setKind(k);
    setContent(null);
    if (!touched) setLabel(autoLabel(k, null));
  };
  const picked = (c: LinkContentWithImage | null) => {
    setContent(c);
    if (!touched) setLabel(autoLabel(kind, c));
  };
  const form = sorted.find((f) => f.id === formId);
  const ready = !!form && label.trim().length > 0 && (kind === "bio" || !!content);

  const create = async () => {
    if (!form) return;
    setBusy(true);
    setErr(undefined);
    try {
      const r = await api.post<{ link: SourceLink & { url: string } }>(`/api/forms/${form.id}/links`, { kind, label: label.trim(), content: content ? stripImageUrl(content) : null });
      setCreated({ link: r.link, live: form.live });
      onCreated();
      toast.success("Link criado. Já está valendo.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={close}
      size="lg"
      title={created ? "Link pronto" : "Rastrear conteúdo"}
      description={created ? undefined : "Crie um link só para este conteúdo. Cada cadastro que vier por ele fica marcado com o conteúdo."}
      footer={
        created ? (
          <>
            <Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={reset}>
              Rastrear outro
            </Button>
            <Button icon={<Check className="size-4" />} onClick={() => close(false)}>
              Concluir
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => close(false)}>
              Cancelar
            </Button>
            <Button onClick={create} loading={busy} disabled={!ready}>
              Criar link
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="w-16 shrink-0">
              <ContentThumb kind={kind} imageUrl={content?.imageUrl} />
            </div>
            <div className="min-w-0">
              <KindBadge kind={kind} />
              <p className="mt-1 break-words text-[15px] font-semibold">{created.link.label}</p>
              <p className="truncate text-[12.5px] text-muted">{form?.name}</p>
            </div>
          </div>
          <CopyField label="Link deste conteúdo" value={created.link.url} what="Link copiado" />
          <p className="rounded-[14px] bg-selected px-3 py-2.5 text-[13.5px] text-ink">{INSTRUCTION[kind]}</p>
          {!created.live && <p className="rounded-[14px] bg-warning-soft px-3 py-2.5 text-[13px] text-warning">Este formulário ainda não está publicado. Publique para o link funcionar.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <fieldset>
            <legend className="mb-1.5 text-[14px] font-medium text-ink">Onde você vai divulgar?</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Tipo de conteúdo">
              {TYPE_CHOICES.map((t) => {
                const active = kind === t.kind;
                return (
                  <button
                    key={t.kind}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => chooseKind(t.kind)}
                    className={cx("flex min-h-[76px] min-w-0 flex-col items-center justify-center gap-1 rounded-[16px] border p-2 text-center transition-colors", active ? "border-brand bg-selected/60 ring-4 ring-[#008a65]/10" : "border-line hover:bg-page")}
                  >
                    <KindIcon kind={t.kind} className={cx("size-5", active ? "text-brand" : "text-muted")} />
                    <span className="text-[13.5px] font-semibold leading-tight text-ink">{t.title}</span>
                    <span className="hidden text-[12px] leading-tight text-muted sm:block">{t.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <Field label="Formulário" htmlFor="track-form" hint={form && !form.live ? "Este formulário é um rascunho: publique para o link funcionar." : undefined}>
            {formsError ? (
              <ErrorState error={formsError} onRetry={() => refreshForms()} className="py-4" />
            ) : !forms ? (
              <div className="skeleton h-11" aria-label="Carregando formulários" />
            ) : !sorted.length ? (
              <p className="rounded-[14px] bg-page px-3 py-2.5 text-[13px] text-muted">Crie um formulário primeiro para rastrear conteúdos.</p>
            ) : (
              <Select id="track-form" value={formId} onChange={(e) => setFormId(e.target.value)}>
                {sorted.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {f.live ? "" : " (rascunho)"}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {kind !== "bio" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[14px] font-medium text-ink">{kind === "stories" ? "Qual Stories?" : "Qual post?"}</span>
              {content ? (
                <div className="flex min-w-0 items-center gap-3 rounded-[16px] border border-line p-3">
                  <div className={cx("shrink-0", kind === "stories" ? "w-14" : "w-16")}>
                    <ContentThumb kind={kind} imageUrl={content.imageUrl} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-3 break-words text-[13px] text-ink">{content.caption ?? (content.source === "upload" ? "Print enviado" : "Sem legenda")}</p>
                    {content.postedAt && <p className="mt-0.5 text-[12px] text-muted">{formatDate(content.postedAt)}</p>}
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => picked(null)}>
                    Trocar
                  </Button>
                </div>
              ) : (
                <ContentPicker key={kind} type={kind} onPicked={picked} />
              )}
            </div>
          )}

          <Field label="Nome do link" htmlFor="track-label" error={err} hint="Aparece nos relatórios e na origem do cadastro.">
            <Input
              id="track-label"
              value={label}
              maxLength={80}
              onChange={(e) => {
                setLabel(e.target.value);
                setTouched(true);
                setErr(undefined);
              }}
            />
          </Field>
          <p className="text-[12.5px] text-muted">{LINK_KIND_LABEL[kind]}: {INSTRUCTION[kind]}</p>
        </div>
      )}
    </Dialog>
  );
}
