"use client";

import { Braces, ClipboardList, FileSpreadsheet, ListChecks, MessagesSquare, Webhook } from "lucide-react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { cx } from "@/components/ui";

export type ProviderId = "crmlabs_form" | "webhook" | "typeform" | "tally" | "google_forms" | "api";

export const PROVIDERS: { id: ProviderId; name: string; description: string; icon: React.ReactNode; tone: string }[] = [
  { id: "crmlabs_form", name: "Formulário CRMLABS", description: "Página pronta para anúncio, bio ou stories.", icon: <ClipboardList />, tone: "bg-selected text-brand" },
  { id: "webhook", name: "Webhook CRMLABS", description: "Zapier, Make, RD Station, landing pages.", icon: <Webhook />, tone: "bg-info-soft text-info" },
  { id: "typeform", name: "Typeform", description: "Formulários e quizzes do Typeform.", icon: <MessagesSquare />, tone: "bg-[#f0eafc] text-[#7048c8]" },
  { id: "tally", name: "Tally", description: "Formulários do Tally.", icon: <ListChecks />, tone: "bg-[#fdf1e7] text-[#b5561b]" },
  { id: "google_forms", name: "Google Forms", description: "Com um script que copiamos para você.", icon: <FileSpreadsheet />, tone: "bg-[#e7f5ec] text-[#13804b]" },
  { id: "api", name: "API personalizada", description: "Para o time técnico enviar de um sistema próprio.", icon: <Braces />, tone: "bg-[#eef2f1] text-[#46565f]" },
];
export const providerOf = (id: string) => PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[1];

export function ProviderIcon({ id, size = 44 }: { id: string; size?: number }) {
  const p = providerOf(id);
  return (
    <span className={cx("flex shrink-0 items-center justify-center rounded-[14px] [&>svg]:size-[45%]", p.tone)} style={{ width: size, height: size }} aria-hidden>
      {p.icon}
    </span>
  );
}

export type Question = { id: string; label: string; type: "text" | "textarea" | "choice" | "number"; required: boolean; options?: string[] };
export type Mapping = { key: string; target: string };

export type Integration = {
  id: string;
  provider: ProviderId;
  name: string;
  slug: string;
  headline: string;
  description: string | null;
  questions: Question[];
  askEmail: boolean;
  askInstagram: boolean;
  askPreferredTime: boolean;
  thankYou: string | null;
  sourceId: string | null;
  campaign: string | null;
  channel: string | null;
  partner: string | null;
  adName: string | null;
  productId: string | null;
  pipelineKind: "relationship" | "sales";
  stageId: string | null;
  salesStageId: string | null;
  assignMode: "round_robin" | "fixed";
  fixedAssigneeId: string | null;
  assigneeIds: string[];
  fieldMap: Mapping[];
  active: boolean;
  status: "active" | "error" | "inactive";
  lastError: string | null;
  lastErrorAt: string | null;
  lastLeadAt: string | null;
  lastSample: { key: string; value: string }[];
  hasSigningSecret: boolean;
  publicUrl: string;
  webhookUrl: string | null;
  leadCount: number;
  createdAt: string;
};

export type Catalog = {
  sources: { id: string; key: string; name: string; color: string }[];
  products: { id: string; name: string }[];
  customFields: { id: string; key: string; label: string; showToCloser: boolean }[];
};

export const useCatalog = () => useSWR<Catalog>("/api/catalog", fetcher);

export const STATUS = {
  active: { label: "Ativa", cls: "bg-success-soft text-success", dot: "bg-success" },
  error: { label: "Com erro", cls: "bg-danger-soft text-danger", dot: "bg-danger" },
  inactive: { label: "Desativada", cls: "bg-[#eef2f1] text-[#46565f]", dot: "bg-[#9aa8b0]" },
} as const;

/** Chip de origem com a cor da origem (sempre acompanhado de texto). */
export function SourceChip({ name, color, className }: { name: string; color?: string | null; className?: string }) {
  const c = color ?? "gray";
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12.5px] font-medium", className)} style={{ background: `var(--stage-${c}-chip)`, color: "#1f2f37" }}>
      <span className="size-2 rounded-full" style={{ background: `var(--stage-${c}-dot)` }} aria-hidden />
      {name}
    </span>
  );
}

export const TARGET_LABEL: Record<string, string> = {
  name: "Nome",
  phone: "Telefone / WhatsApp",
  email: "E-mail",
  instagram: "Instagram",
  product: "Produto de interesse",
  answer: "Guardar como resposta",
  ignore: "Ignorar",
};
