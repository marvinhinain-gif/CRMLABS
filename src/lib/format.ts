export const TZ = "America/Bahia";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlShort = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export const formatBRL = (cents: number, short = false) => (short ? brlShort : brl).format((cents ?? 0) / 100);

/** "1.234,56" → 123456 centavos */
export function parseBRLToCents(v: string): number | null {
  const clean = v.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  if (!clean) return 0;
  const n = Number(clean);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function parts(d: Date) {
  const f = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
  const o = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { y: o.year, m: o.month, d: o.day, h: o.hour, min: o.minute, key: `${o.year}-${o.month}-${o.day}` };
}

export const toDate = (v: string | Date | null | undefined) => (v ? (v instanceof Date ? v : new Date(v)) : null);

export function formatDate(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatDateTime(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function formatTime(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "";
  const p = parts(d);
  return `${p.h}:${p.min}`;
}

/** "Hoje, 10:00" · "Amanhã, 09:00" · "Ontem, 14:00" · "12/10, 09:30" */
export function dayLabel(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "";
  const p = parts(d);
  const now = Date.now();
  const today = parts(new Date(now)).key;
  const tomorrow = parts(new Date(now + 86400000)).key;
  const yesterday = parts(new Date(now - 86400000)).key;
  const time = `${p.h}:${p.min}`;
  if (p.key === today) return `Hoje, ${time}`;
  if (p.key === tomorrow) return `Amanhã, ${time}`;
  if (p.key === yesterday) return `Ontem, ${time}`;
  return `${p.d}/${p.m}, ${time}`;
}

export type DueTone = "overdue" | "today" | "future" | "none";
export function dueTone(v: string | Date | null | undefined): DueTone {
  const d = toDate(v);
  if (!d) return "none";
  const key = parts(d).key;
  const today = parts(new Date()).key;
  if (key < today) return "overdue";
  if (key === today) return d.getTime() < Date.now() ? "overdue" : "today";
  return "future";
}

export function relativeTime(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "";
  const diff = Date.now() - d.getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "Agora";
  if (min < 60) return `Há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `Há ${h} hora${h > 1 ? "s" : ""}`;
  const days = Math.round(h / 24);
  if (days < 7) return `Há ${days} dia${days > 1 ? "s" : ""}`;
  return formatDate(d);
}

/** Valor para <input type="datetime-local"> no fuso padrão. */
export function toLocalInput(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "";
  const p = parts(d);
  return `${p.y}-${p.m}-${p.d}T${p.h}:${p.min}`;
}

/** Converte valor de datetime-local (interpretado em America/Bahia, UTC−3 fixo) para ISO UTC. */
export function fromLocalInput(v: string) {
  if (!v) return null;
  return new Date(`${v}:00-03:00`).toISOString();
}

export function initials(name?: string | null) {
  if (!name) return "?";
  const clean = name.replace(/^@/, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Chave do dia no fuso da operação: "2026-10-10". */
export function dayKey(v: string | Date) {
  return parts(toDate(v)!).key;
}

/** Hora "HH:mm" e data "YYYY-MM-DD" no fuso da operação (para campos de formulário). */
export function localInputs(v: string | Date) {
  const p = parts(toDate(v)!);
  return { date: p.key, time: `${p.h}:${p.min}` };
}

/** Data + hora digitadas (fuso da operação, UTC−3) → ISO. */
export function fromLocalInputs(date: string, time: string) {
  return new Date(`${date}T${time || "00:00"}:00-03:00`).toISOString();
}

/** "+5571999991111" → "(71) 99999-1111" */
export function formatPhone(v: string | null | undefined) {
  if (!v) return "";
  const d = v.replace(/\D/g, "");
  const br = d.startsWith("55") && (d.length === 12 || d.length === 13) ? d.slice(2) : null;
  if (!br) return v;
  const ddd = br.slice(0, 2);
  const rest = br.slice(2);
  return rest.length === 9 ? `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}` : `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
}

/** Link do WhatsApp com mensagem pronta. */
export function whatsappLink(phone: string | null | undefined, text?: string) {
  if (!phone) return null;
  let d = phone.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  if (d.length < 10) return null;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** "sex., 10 de out. · 14:00" */
export function longDayTime(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "";
  const day = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short" }).format(d);
  return `${day} · ${formatTime(d)}`;
}

/** Tempo curto das listas da caixa de entrada: "agora", "5 min", "2 h", "3 d", "2 sem". */
export function shortAgo(v: string | Date | null | undefined) {
  const d = toDate(v);
  if (!d) return "";
  const min = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} d`;
  return `${Math.floor(days / 7)} sem`;
}
