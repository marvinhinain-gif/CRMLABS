"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Badge, Button, Card, cx, Dialog, Tabs } from "@/components/ui";
import { FORM_STATUS_LABEL, type FormStatus, type QuizDefinition } from "@/lib/quiz/types";

// ---------- Tipos das respostas da API ----------

export type EmbedCode = { iframe: string; script: string; fullscreen: string };

export type FormSummary = {
  id: string;
  name: string;
  slug: string;
  status: FormStatus;
  title: string;
  createdAt: string;
  updatedAt: string;
  draftUpdatedAt: string;
  publishedAt: string | null;
  live: boolean;
  hasUnpublishedChanges: boolean;
  allowedDomains: string[];
  templateKey: string | null;
  publicUrl: string;
  embed: EmbedCode;
};

export type FormListItem = FormSummary & { responses: number; views: number; conversion: number };

export type FormDetail = FormSummary & {
  draft: QuizDefinition;
  versions: { id: string; version: number; publishedAt: string; publishedBy: string | null; maxPoints: number }[];
  liveVersion: number | null;
  responses: number;
  problems: string[];
};

export type EditorOptions = {
  relationshipStages: { id: string; name: string; color: string | null }[];
  salesStages: { id: string; name: string; color: string | null }[];
  team: { userId: string; name: string; role: string }[];
  sources: { id: string; name: string; color: string | null }[];
  products: { id: string; name: string }[];
  customFields: { key: string; label: string }[];
  appUrl: string;
};

export type Counted = { label: string; count: number };

export type SubmissionDetail = {
  id: string;
  formId: string;
  formName: string;
  formTitle: string;
  version: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  instagram: string | null;
  company: string | null;
  score: number | null;
  rawPoints: number | null;
  maxPoints: number | null;
  tierId: string | null;
  tierLabel: string | null;
  tierColor: string;
  scoreTierLabel: string | null;
  demotions: { tier: string; failed: string[] }[];
  channel: "link" | "embed";
  origin: string;
  utm: Record<string, string | undefined>;
  referrer: string | null;
  completedAt: string;
  startedAt: string | null;
  contactId: string | null;
  lead: { id: string; status: string; assignedName: string | null } | null;
  duplicateOf: string | null;
  anonymizedAt: string | null;
  route: { mode: "relationship" | "sales" | "none"; assignMode: string } | null;
  sections: { title: string; answers: { questionId: string; title: string; type: string; value: string; points: number | null; maxPoints: number | null }[] }[];
  consents: { kind: string; granted: boolean; textVersion: string; text: string; createdAt: string }[];
  history: { id: string; score: number | null; rawPoints: number; maxPoints: number; tierLabel: string | null; reason: string; createdAt: string; actorName: string | null; version: number | null }[];
};

// ---------- Rótulos ----------

export const LEAD_STATUS_LABEL: Record<string, string> = { new: "Novo", contacted: "Contatado", scheduled: "Agendado", no_answer: "Sem resposta", disqualified: "Desqualificado" };

export const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

const TIER_TONES: Record<string, [string, string]> = {
  green: ["#e3f4ec", "#147d55"],
  blue: ["#e7effb", "#2463b5"],
  yellow: ["#fdf3dc", "#9a6700"],
  gray: ["#eef2f1", "#46565f"],
  red: ["#fbe9ee", "#bf3a5b"],
  purple: ["#f0eafc", "#7048c8"],
  teal: ["#e6f6f5", "#0e7f76"],
};
export const TIER_COLORS = Object.keys(TIER_TONES);
export const tierTone = (color?: string | null) => TIER_TONES[color ?? "gray"] ?? TIER_TONES.gray;

export function TierBadge({ label, color }: { label: string | null; color?: string | null }) {
  if (!label) return <span className="text-[13px] text-muted">—</span>;
  const [bg, fg] = tierTone(color);
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>
      {label}
    </span>
  );
}

export function StatusBadge({ status, live, pending }: { status: FormStatus; live?: boolean; pending?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge tone={status === "published" && live ? "success" : status === "archived" ? "neutral" : "warning"}>{FORM_STATUS_LABEL[status]}</Badge>
      {pending && status === "published" && <Badge tone="info">Alterações não publicadas</Badge>}
    </span>
  );
}

// ---------- Copiar ----------

export async function copyText(text: string, what = "Copiado") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what}.`);
    return true;
  } catch {
    toast.error("Não foi possível copiar. Selecione o texto e copie manualmente.");
    return false;
  }
}

export function CopyField({ value, label, multiline, what }: { value: string; label: string; multiline?: boolean; what?: string }) {
  const [done, setDone] = useState(false);
  const onCopy = async () => {
    if (await copyText(value, what ?? `${label} copiado`)) {
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-ink">{label}</span>
        <Button size="sm" variant={done ? "soft" : "secondary"} icon={done ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={onCopy}>
          {done ? "Copiado" : "Copiar"}
        </Button>
      </div>
      {multiline ? (
        <pre className="max-h-40 overflow-auto scroll-thin whitespace-pre-wrap break-all rounded-[14px] border border-line bg-page px-3.5 py-3 font-mono text-[12.5px] text-ink" aria-label={label}>
          {value}
        </pre>
      ) : (
        <input readOnly value={value} aria-label={label} onFocus={(e) => e.currentTarget.select()} className="h-11 w-full truncate rounded-[14px] border border-line bg-page px-3.5 text-[14px] text-ink" />
      )}
    </div>
  );
}

/** Link público + códigos de incorporação (iframe e script com altura automática). */
export function EmbedCodes({ form }: { form: Pick<FormSummary, "publicUrl" | "embed"> }) {
  const [kind, setKind] = useState<"iframe" | "script" | "fullscreen">("script");
  return (
    <div className="flex flex-col gap-4">
      <CopyField label="Link público" value={form.publicUrl} what="Link copiado" />
      <Tabs
        value={kind}
        onChange={setKind}
        items={[
          { value: "script", label: "Altura automática" },
          { value: "iframe", label: "Iframe" },
          { value: "fullscreen", label: "Tela cheia" },
        ]}
      />
      {kind === "script" && <CopyField multiline label="Código com ajuste automático de altura" value={form.embed.script} what="Código copiado" />}
      {kind === "iframe" && <CopyField multiline label="Código iframe" value={form.embed.iframe} what="Código copiado" />}
      {kind === "fullscreen" && <CopyField multiline label="Código em tela cheia" value={form.embed.fullscreen} what="Código copiado" />}
      <p className="text-[12.5px] text-muted">
        {kind === "script"
          ? "Recomendado: o formulário cresce e diminui conforme as perguntas, sem barra de rolagem, e repassa as UTMs da página."
          : kind === "iframe"
            ? "Iframe simples com 100% de largura. Ajuste a altura se precisar."
            : "Ocupa a tela inteira da página onde for colado. Bom para páginas dedicadas."}
      </p>
    </div>
  );
}

export function EmbedDialog({ form, open, onOpenChange }: { form: FormSummary | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open && !!form} onOpenChange={onOpenChange} title="Link e incorporação" description={form ? `${form.title}${form.live ? "" : " · publique o formulário para o link funcionar"}` : undefined}>
      {form && <EmbedCodes form={form} />}
    </Dialog>
  );
}

// ---------- Gráficos simples ----------

export function Kpi({ icon, label, value, sub, i = 0 }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode; i?: number }) {
  return (
    <div className="anim-rise min-w-0" style={{ "--i": i } as CSSProperties}>
      <Card className="h-full p-4 sm:p-5">
        <span className="flex size-10 items-center justify-center rounded-[14px] bg-selected text-brand [&>svg]:size-5" aria-hidden>
          {icon}
        </span>
        <p className="mt-3 text-[13px] sm:text-[14px] font-medium text-ink">{label}</p>
        <p className="mt-0.5 truncate text-[24px] sm:text-[28px] font-bold leading-tight tracking-tight text-[#0f1f1a]">{value}</p>
        {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
      </Card>
    </div>
  );
}

export function BarList({ rows, empty = "Sem dados no período.", colorOf }: { rows: { label: string; count: number; color?: string | null }[]; empty?: string; colorOf?: (label: string) => string | null | undefined }) {
  const total = rows.reduce((a, r) => a + r.count, 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length || !total) return <p className="py-6 text-center text-[13.5px] text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => {
        const color = r.color ?? colorOf?.(r.label);
        const [, fg] = color ? tierTone(color) : ["", "#008a65"];
        return (
          <li key={r.label} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
              <span className="truncate font-medium text-ink">{r.label}</span>
              <span className="shrink-0 text-muted">
                <b className="text-ink">{r.count.toLocaleString("pt-BR")}</b> · {pct(r.count / total)}
              </span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-page">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(r.count / max) * 100}%`, background: fg }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const shortDay = (k: string) => {
  const [, m, d] = k.split("-");
  return `${d}/${m}`;
};

export function DailyChart({ series, label = "Respostas" }: { series: { day: string; count: number }[]; label?: string }) {
  const max = Math.max(1, ...series.map((s) => s.count));
  const total = series.reduce((a, s) => a + s.count, 0);
  const tick = Math.max(1, Math.ceil(series.length / 8));
  return (
    <div>
      <div className="flex h-44 items-end gap-[3px]" role="img" aria-label={`${label} por dia: ${total} no total`}>
        {series.map((s) => (
          <div key={s.day} className="group relative flex h-full flex-1 items-end">
            <div className={cx("w-full rounded-t-[4px] transition-colors", s.count ? "bg-brand/80 group-hover:bg-brand" : "bg-page")} style={{ height: s.count ? `${Math.max(6, (s.count / max) * 100)}%` : "4px" }} />
            <span className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-[8px] bg-ink px-2 py-1 text-[11.5px] text-white opacity-0 group-hover:opacity-100">
              {shortDay(s.day)}: {s.count}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-[3px] text-[11px] text-muted">
        {series.map((s, i) => (
          <span key={s.day} className="flex-1 text-center">
            {i % tick === 0 ? shortDay(s.day) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
