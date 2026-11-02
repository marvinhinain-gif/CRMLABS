"use client";

import { Camera, CircleDot, MessageCircle, PhoneCall } from "lucide-react";
import { useSWRConfig } from "swr";
import { CHANNEL_LABEL, OUTCOME_LABEL, STATUS_LABEL, type CadenceActivityOutcome, type CadenceChannel, type CadenceStatus } from "@/lib/cadence";
import { dayLabel, dueTone } from "@/lib/format";
import { cx } from "@/components/ui";

/** Ícone de cada canal da cadência (mesmo traço dos demais ícones). */
export function ChannelGlyph({ channel, className }: { channel: CadenceChannel | null | undefined; className?: string }) {
  const Icon = channel === "call" ? PhoneCall : channel === "whatsapp" ? MessageCircle : channel === "instagram" ? Camera : CircleDot;
  return <Icon className={cx("shrink-0", className)} aria-hidden />;
}

export const channelLabel = (c: CadenceChannel | null | undefined) => (c ? CHANNEL_LABEL[c] : "");

export const outcomeLabel = (o: string) => OUTCOME_LABEL[o as CadenceActivityOutcome] ?? o;

export const STATUS_TONE: Record<CadenceStatus, string> = {
  active: "bg-info-soft text-info",
  responded: "bg-success-soft text-success",
  scheduled: "bg-selected text-brand",
  lost: "bg-[#eef2f1] text-[#46565f]",
  finished: "bg-[#eef2f1] text-[#46565f]",
};

export function StatusPill({ status, className }: { status: CadenceStatus; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium whitespace-nowrap", STATUS_TONE[status], className)}>{STATUS_LABEL[status]}</span>;
}

/** Prazo do passo: "Atrasado · Ontem, 10:00", "Hoje, 14:00" ou a data. */
export function CadenceDueChip({ at, className }: { at: string | null; className?: string }) {
  if (!at) return null;
  const tone = dueTone(at);
  const cls = tone === "overdue" ? "bg-danger-soft text-danger" : tone === "today" ? "bg-success-soft text-success" : "bg-info-soft text-info";
  return (
    <span className={cx("inline-flex h-7 items-center rounded-full px-2.5 text-[12.5px] font-medium whitespace-nowrap", cls, className)}>
      {tone === "overdue" ? `Atrasado · ${dayLabel(at)}` : dayLabel(at)}
    </span>
  );
}

/** "no mesmo dia" · "1 dia depois" · "3 dias depois" */
export function waitLabel(days: number) {
  if (!days) return "no mesmo dia";
  return `${days} dia${days > 1 ? "s" : ""} depois`;
}

/**
 * Do roteiro já preenchido, tira só a mensagem a mandar (o texto entre aspas depois de
 * "O que mandar:" / "O que falar:"). Sem aspas, usa o roteiro inteiro.
 */
export function messageFromScript(filled: string) {
  const line = filled.split("\n").find((l) => /^\s*o que (mandar|falar)\s*:/i.test(l));
  const source = line ?? filled;
  const quoted = source.match(/["“]([\s\S]+?)["”]/);
  if (quoted) return quoted[1].trim();
  return (line ? line.replace(/^\s*o que (mandar|falar)\s*:\s*/i, "") : filled).trim();
}

/** Revalida quadro, fila da cadência e painel do contato depois de uma ação. */
export function useRefreshCadence() {
  const { mutate } = useSWRConfig();
  return () => mutate((k) => typeof k === "string" && (k.startsWith("/api/board") || k.startsWith("/api/cadence") || /^\/api\/contacts\/[^/?]+(\/cadence)?$/.test(k)));
}
