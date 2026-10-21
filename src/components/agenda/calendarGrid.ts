import { dayKey, TZ } from "@/lib/format";

/** Peças do calendário mensal (Agendamentos e Agenda da equipe). */
export const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
export const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Dia de hoje no fuso da operação, como "YYYY-MM-DD". */
export const todayKey = () => dayKey(new Date());
export const keyOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const startIso = (key: string) => new Date(`${key}T00:00:00-03:00`).toISOString();
/** Dia seguinte a uma chave "YYYY-MM-DD". */
export const nextKey = (key: string) => dayKey(new Date(new Date(`${key}T12:00:00-03:00`).getTime() + 86400000));

export function monthGrid(y: number, m: number) {
  const first = new Date(Date.UTC(y, m, 1));
  const startDow = first.getUTCDay();
  const cells: { key: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(y, m, 1 - startDow + i));
    cells.push({ key: keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m });
  }
  // Remove a última semana se ela estiver toda fora do mês.
  return cells.slice(35).every((c) => !c.inMonth) ? cells.slice(0, 35) : cells;
}

export function dayTitle(key: string) {
  const d = new Date(`${key}T12:00:00-03:00`);
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
  const t = todayKey();
  const tomorrow = dayKey(new Date(Date.now() + 86400000));
  return key === t ? `Hoje · ${label}` : key === tomorrow ? `Amanhã · ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
}
