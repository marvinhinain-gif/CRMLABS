"use client";

import { useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CircleAlert, ExternalLink, Images, Link2, Smartphone, Upload, UserRound } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { LINK_KIND_LABEL, type LinkContent, type LinkKind } from "@/lib/quiz/types";
import { Badge, Button, cx, Dialog, ErrorState, Spinner } from "@/components/ui";
import { uploadImage } from "./editor/common";
import { assetSrc } from "./QuizRunner";
import type { LinkContentView } from "./shared";

// ---------- Tipos da API ----------

export type ContentType = "feed" | "stories";
export type LinkContentWithImage = LinkContent & { imageUrl: string | null };
type InstagramItem = { externalId: string; mediaType: string | null; caption: string | null; permalink: string | null; previewUrl: string | null; postedAt: string | null };
type InstagramList = { connected: boolean; username: string | null; items: InstagramItem[]; error?: string };

export const withImageUrl = (c: LinkContent): LinkContentWithImage => ({ ...c, imageUrl: assetSrc(c.imageId) });
/** O rascunho guarda só o conteúdo (a URL da foto é montada na leitura). */
export const stripImageUrl = (c: LinkContent & { imageUrl?: string | null }): LinkContent => {
  const { imageUrl: _imageUrl, ...rest } = c;
  return rest;
};

// ---------- Visual do conteúdo ----------

const KIND_ICON: Partial<Record<LinkKind, typeof Smartphone>> = { stories: Smartphone, feed: Images, bio: UserRound };

export function KindIcon({ kind, className }: { kind: LinkKind; className?: string }) {
  const Icon = KIND_ICON[kind] ?? Link2;
  return <Icon className={className} aria-hidden />;
}

export function KindBadge({ kind }: { kind: LinkKind }) {
  return (
    <Badge tone={kind === "stories" ? "brand" : kind === "feed" ? "info" : "neutral"}>
      <KindIcon kind={kind} className="size-3.5" />
      {LINK_KIND_LABEL[kind] ?? kind}
    </Badge>
  );
}

/** Foto do conteúdo no formato do Instagram (Stories 9:16, feed 4:5); bio e sem foto viram um bloco com ícone. */
export function ContentThumb({ kind, imageUrl, className, alt = "" }: { kind: LinkKind; imageUrl: string | null | undefined; className?: string; alt?: string }) {
  const ratio = kind === "stories" ? "aspect-[9/16]" : kind === "feed" ? "aspect-[4/5]" : "aspect-square";
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt={alt} loading="lazy" className={cx("block w-full rounded-[14px] border border-line bg-page object-cover", ratio, className)} />;
  }
  return (
    <div className={cx("flex w-full items-center justify-center rounded-[14px] border border-line bg-selected text-brand", ratio, className)} aria-hidden>
      <KindIcon kind={kind} className="size-1/3 max-h-10 max-w-10" />
    </div>
  );
}

/** "Veio deste conteúdo": foto, tipo, nome, legenda e link para o post. `compact` para o painel do lead. */
export function LinkContentCard({ view, compact }: { view: LinkContentView; compact?: boolean }) {
  const c = view.content;
  return (
    <section className={cx("rounded-[18px] border border-line", compact ? "mt-3 p-3" : "p-4")} aria-label="Veio deste conteúdo">
      <p className={cx("font-semibold text-muted", compact ? "text-[12px]" : "text-[12.5px]")}>Veio deste conteúdo</p>
      <div className="mt-2 flex min-w-0 items-start gap-3">
        <div className={cx("shrink-0", compact ? "w-12" : "w-20 sm:w-24")}>
          <ContentThumb kind={view.kind} imageUrl={c?.imageUrl} alt={view.label} className={compact ? "rounded-[10px]" : undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={view.kind} />
            {c?.postedAt && <span className="text-[12px] text-muted">{formatDate(c.postedAt)}</span>}
          </div>
          <p className={cx("mt-1 break-words font-semibold text-ink", compact ? "text-[13.5px]" : "text-[14.5px]")}>{view.label}</p>
          {c?.caption && <p className={cx("mt-0.5 break-words text-muted", compact ? "line-clamp-2 text-[12.5px]" : "line-clamp-4 whitespace-pre-line text-[13px]")}>{c.caption}</p>}
          {c?.permalink && (
            <a href={c.permalink} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex min-h-8 items-center gap-1.5 text-[13px] font-semibold text-brand hover:underline">
              <ExternalLink className="size-3.5" aria-hidden /> Ver no Instagram
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------- Escolher o conteúdo ----------

/** Lista os posts/Stories da conta e guarda a foto do escolhido. Sem conta (ou com erro), aceita um print. */
export function ContentPicker({ type, onPicked }: { type: ContentType; onPicked: (c: LinkContentWithImage) => void }) {
  const { data, error, isLoading, mutate } = useSWR<InstagramList>(`/api/forms/instagram-content?type=${type}`, fetcher, { revalidateOnFocus: false });
  const [picking, setPicking] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const pick = async (item: InstagramItem) => {
    setPicking(item.externalId);
    try {
      const c = await api.post<LinkContent>("/api/forms/content-snapshot", { type, externalId: item.externalId });
      if (!c.imageId) toast.warning("Não deu para guardar a foto deste conteúdo, mas o link funciona normalmente.");
      onPicked(withImageUrl(c));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPicking(null);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Escolha um arquivo de imagem (PNG, JPG ou WEBP).");
    if (file.size > 8 * 1024 * 1024) return toast.error("Imagem grande demais (máximo 8 MB).");
    setUploading(true);
    try {
      const r = await uploadImage(file, "image");
      onPicked(withImageUrl({ source: "upload", mediaType: null, externalId: null, permalink: null, caption: null, postedAt: null, imageId: r.id }));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  const items = data?.items ?? [];
  const what = type === "stories" ? "Stories" : "post";
  const problem = !data ? null : !data.connected ? (data.error ?? "O Instagram não está conectado. Conecte em Integrações para escolher direto da sua conta.") : data.error ? data.error : !items.length ? (type === "stories" ? "Nenhum Stories publicado nas últimas 24 horas." : "Nenhum post encontrado na sua conta.") : null;

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <ErrorState error={error} onRetry={() => mutate()} className="py-6" />
      ) : isLoading && !data ? (
        <div className={cx("grid grid-cols-3 gap-2", type === "stories" ? "sm:grid-cols-5" : "sm:grid-cols-4")} aria-busy="true" aria-label="Carregando conteúdos">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={cx("skeleton rounded-[14px]", type === "stories" ? "aspect-[9/16]" : "aspect-[4/5]")} />
          ))}
        </div>
      ) : problem ? (
        <p className="flex items-start gap-2 rounded-[14px] bg-page px-3 py-2.5 text-[13px] text-ink">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
          <span>
            {problem} Você pode enviar um print do {what} no lugar.
          </span>
        </p>
      ) : (
        <>
          <p className="text-[13px] text-muted">
            {type === "stories" ? "Stories publicados nas últimas 24 horas" : "Seus posts mais recentes"}
            {data?.username ? ` em @${data.username}` : ""}. Toque no que vai divulgar o link.
          </p>
          <ul className={cx("grid grid-cols-3 gap-2", type === "stories" ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
            {items.map((it) => (
              <li key={it.externalId} className="min-w-0">
                <button
                  type="button"
                  disabled={!!picking}
                  onClick={() => pick(it)}
                  className="group relative block w-full rounded-[14px] text-left outline-none focus-visible:ring-4 focus-visible:ring-[#008a65]/25 disabled:cursor-wait"
                  aria-label={`Escolher ${it.caption ? it.caption.slice(0, 60) : what}${it.postedAt ? ` de ${formatDate(it.postedAt)}` : ""}`}
                >
                  {it.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.previewUrl} alt="" referrerPolicy="no-referrer" loading="lazy" className={cx("block w-full rounded-[14px] border border-line bg-page object-cover transition group-hover:brightness-95", type === "stories" ? "aspect-[9/16]" : "aspect-[4/5]")} />
                  ) : (
                    <ContentThumb kind={type} imageUrl={null} />
                  )}
                  {it.mediaType === "VIDEO" && <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10.5px] font-medium text-white">Vídeo</span>}
                  {it.postedAt && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/55 px-1.5 py-0.5 text-[10.5px] font-medium text-white">{formatDate(it.postedAt).slice(0, 5)}</span>}
                  {picking === it.externalId && (
                    <span className="absolute inset-0 flex items-center justify-center rounded-[14px] bg-white/70">
                      <Spinner />
                    </span>
                  )}
                </button>
                {it.caption && <p className="mt-1 line-clamp-2 break-words text-[11.5px] leading-snug text-muted">{it.caption}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant={problem ? "primary" : "secondary"} icon={<Upload className="size-4" />} loading={uploading} disabled={!!picking} onClick={() => input.current?.click()}>
          Enviar um print
        </Button>
        {!problem && <span className="text-[12.5px] text-muted">Não achou? Envie um print do {what}.</span>}
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </div>
  );
}

/** O mesmo seletor dentro de um diálogo (usado no editor de links). */
export function ContentPickerDialog({ type, open, onOpenChange, onPicked }: { type: ContentType; open: boolean; onOpenChange: (v: boolean) => void; onPicked: (c: LinkContentWithImage) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title={type === "stories" ? "Escolher o Stories" : "Escolher o post do feed"} description="A foto fica guardada no CRM, mesmo depois que o Stories sair do ar.">
      {open && (
        <ContentPicker
          type={type}
          onPicked={(c) => {
            onPicked(c);
            onOpenChange(false);
          }}
        />
      )}
    </Dialog>
  );
}
