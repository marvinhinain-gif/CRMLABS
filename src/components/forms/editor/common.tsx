"use client";

import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { ImagePlus, Trash2 } from "lucide-react";
import { ApiError } from "@/lib/api";
import type { QuizDefinition } from "@/lib/quiz/types";
import { Button, Card, cx } from "@/components/ui";
import { assetSrc } from "../QuizRunner";
import type { EditorOptions } from "../shared";

/** Aplica uma alteração ao rascunho (o editor trabalha numa cópia). */
export type Update = (fn: (d: QuizDefinition) => void) => void;

export type EditorProps = { draft: QuizDefinition; update: Update; options: EditorOptions };

export async function uploadImage(file: File, kind: "logo" | "cover" | "image") {
  const body = new FormData();
  body.set("file", file);
  body.set("kind", kind);
  const res = await fetch("/api/forms/assets", { method: "POST", body, credentials: "same-origin" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.error?.message ?? "Não foi possível enviar a imagem.", res.status);
  return data as { id: string; url: string };
}

export function ImagePicker({ value, onChange, kind, label, hint }: { value: string | null | undefined; onChange: (id: string | null) => void; kind: "logo" | "cover" | "image"; label: string; hint?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("Escolha um arquivo de imagem (PNG, JPG, WEBP ou SVG).");
    if (file.size > 8 * 1024 * 1024) return toast.error("Imagem grande demais (máximo 8 MB).");
    setBusy(true);
    try {
      const r = await uploadImage(file, kind);
      onChange(r.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  const src = assetSrc(value);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[14px] font-medium text-ink">{label}</span>
      <div className="flex items-center gap-3">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" className={cx("rounded-[12px] border border-line bg-page object-contain", kind === "cover" ? "h-16 w-28 object-cover" : "size-16")} />
        ) : (
          <div className={cx("flex items-center justify-center rounded-[12px] border border-dashed border-line bg-page text-muted", kind === "cover" ? "h-16 w-28" : "size-16")}>
            <ImagePlus className="size-5" aria-hidden />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>
            {src ? "Trocar" : "Enviar imagem"}
          </Button>
          {src && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => onChange(null)}>
              Remover
            </Button>
          )}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={label} />
      </div>
      {hint && <p className="text-[12.5px] text-muted">{hint}</p>}
    </div>
  );
}

export function Panel({ title, description, children, actions, className }: { title: string; description?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <Card className={cx("p-4 sm:p-6", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Card>
  );
}

/** Campo de etiquetas separadas por vírgula ou Enter. */
export function TagInput({ value, onChange, placeholder, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string }) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.slice(0, 40));
    if (!parts.length) return;
    onChange([...new Set([...value, ...parts])]);
    setText("");
  };
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-[14px] border border-line bg-white px-2 py-1.5 focus-within:border-brand focus-within:ring-4 focus-within:ring-[#008a65]/10">
      {value.map((t) => (
        <span key={t} className="inline-flex items-center gap-1 rounded-full bg-selected px-2.5 py-1 text-[12.5px] font-medium text-brand">
          {t}
          <button type="button" aria-label={`Remover ${t}`} className="text-brand/70 hover:text-brand" onClick={() => onChange(value.filter((x) => x !== t))}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={text}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(text);
          } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(text)}
        placeholder={value.length ? "" : placeholder}
        className="h-8 min-w-[120px] flex-1 bg-transparent px-1.5 text-[14px] outline-none placeholder:text-[#94a3ad]"
      />
    </div>
  );
}

/** Seleção múltipla de pessoas da equipe. */
export function PeoplePicker({ team, value, onChange, roles }: { team: EditorOptions["team"]; value: string[]; onChange: (v: string[]) => void; roles?: string[] }) {
  const list = roles ? team.filter((p) => roles.includes(p.role) || value.includes(p.userId)) : team;
  if (!list.length) return <p className="text-[13px] text-muted">Ninguém com esse papel na equipe.</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {list.map((p) => {
        const on = value.includes(p.userId);
        return (
          <button
            key={p.userId}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== p.userId) : [...value, p.userId])}
            className={cx("rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors", on ? "border-brand bg-selected text-brand" : "border-line text-ink hover:bg-page")}
          >
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
