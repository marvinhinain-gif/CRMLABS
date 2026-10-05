import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay, startOfMonth, addMonths, subDays } from "date-fns";

/** Início e fim (exclusivo) do dia de `ref` no fuso informado, em UTC. */
export function dayRange(ref: Date, tz: string) {
  const local = new TZDate(ref.getTime(), tz);
  const start = startOfDay(local);
  const end = addDays(start, 1);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

export type PeriodKey = "today" | "7d" | "30d" | "month" | "last_month";

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  last_month: "Mês passado",
};

/** Intervalo [start, end) do período no fuso da organização. */
export function periodRange(key: PeriodKey, tz: string, now = new Date()) {
  const local = new TZDate(now.getTime(), tz);
  const today = startOfDay(local);
  const tomorrow = addDays(today, 1);
  let start: Date;
  let end: Date = tomorrow;
  switch (key) {
    case "today":
      start = today;
      break;
    case "7d":
      start = subDays(tomorrow, 7);
      break;
    case "30d":
      start = subDays(tomorrow, 30);
      break;
    case "month":
      start = startOfMonth(local);
      end = addMonths(start, 1);
      break;
    case "last_month":
      end = startOfMonth(local);
      start = addMonths(end, -1);
      break;
  }
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

import { sql } from "drizzle-orm";

/** Parâmetro de data seguro para fragmentos SQL brutos (sempre em UTC). */
export function tsz(d: Date | null | undefined) {
  return d ? sql`${d.toISOString()}::timestamptz` : sql`null::timestamptz`;
}

/** "2026-10-10T14:30" (horário local do fuso) → instante UTC. Retorna null se inválido. */
export function parseLocalDateTime(value: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const local = new TZDate(y, mo - 1, d, h, mi, 0, tz);
  const out = new Date(local.getTime());
  return Number.isNaN(out.getTime()) ? null : out;
}
