"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { CalendarCheck, CalendarPlus, ChevronLeft, ChevronRight, CircleAlert, Clock, Pencil } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { formatTime, localInputs } from "@/lib/format";
import { Button, Card, cx, Dialog, ErrorState, Field, Input, LoadingState } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { dayTitle, nextKey, todayKey } from "../calendarGrid";

type Slot = { start: string; end: string };
type Person = {
  userId: string;
  name: string;
  google: "connected" | "not_connected" | "error";
  count: number;
  allDay: number;
  /** Horário de atendimento ("HH:MM") e se é da própria pessoa (senão, padrão da equipe). */
  workStart: string;
  workEnd: string;
  ownHours: boolean;
  busy: (Slot & { source: "crm" | "google" })[];
  free: Slot[];
};
type Availability = { date: string; workStart: string; workEnd: string; canEditTeam: boolean; people: Person[] };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const prevKey = (key: string) => localInputs(new Date(new Date(`${key}T12:00:00-03:00`).getTime() - 86400000)).date;

function duration(s: Slot) {
  const min = Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;
}

/** Faixa do dia com o horário de atendimento e os horários ocupados (sem o nome do compromisso). */
function Timeline({ date, from, to, work, busy }: { date: string; from: number; to: number; work: [string, string]; busy: Person["busy"] }) {
  const t0 = new Date(`${date}T${String(from).padStart(2, "0")}:00:00-03:00`).getTime();
  const span = (to - from) * 3600000;
  const at = (ms: number) => Math.min(100, Math.max(0, ((ms - t0) / span) * 100));
  const pct = (t: string) => at(new Date(t).getTime());
  const day0 = new Date(`${date}T00:00:00-03:00`).getTime();
  const ws = at(day0 + toMin(work[0]) * 60000);
  const we = at(day0 + toMin(work[1]) * 60000);
  const now = Date.now();
  const nowPct = date === todayKey() && now > t0 && now < t0 + span ? ((now - t0) / span) * 100 : null;
  const step = to - from > 12 ? 2 : 1;
  return (
    <div>
      <div className="relative h-7 overflow-hidden rounded-[10px] bg-[repeating-linear-gradient(135deg,#eef1f2_0_6px,#e2e7e9_6px_12px)]" role="img" aria-label={`${busy.length} horário(s) ocupado(s)`}>
        <span className="absolute inset-y-0 bg-[#e3f5ec]" style={{ left: `${ws}%`, width: `${Math.max(0, we - ws)}%` }} aria-hidden />
        {busy.map((b, i) => {
          const l = pct(b.start);
          const w = pct(b.end) - l;
          if (w <= 0) return null;
          return (
            <span
              key={i}
              title={`${formatTime(b.start)}–${formatTime(b.end)} · ocupado`}
              className={cx("absolute inset-y-0 border-x border-white/70", b.source === "google" ? "bg-[#9aa8b1]" : "bg-brand")}
              style={{ left: `${l}%`, width: `${w}%` }}
            />
          );
        })}
        {nowPct != null && <span className="absolute inset-y-0 w-0.5 bg-danger" style={{ left: `${nowPct}%` }} aria-hidden />}
      </div>
      <div className="relative mt-1 h-4 text-[11px] text-muted" aria-hidden>
        {Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step).map((h, i, all) => (
          <span key={h} className={cx("absolute", i === 0 ? "left-0" : i === all.length - 1 ? "right-0" : "-translate-x-1/2")} style={i === 0 || i === all.length - 1 ? undefined : { left: `${((h - from) / (to - from)) * 100}%` }}>
            {h}h
          </span>
        ))}
      </div>
    </div>
  );
}

/** Muda o horário de atendimento de uma pessoa ou o padrão da equipe. */
function HoursDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { userId?: string; name: string; start: string; end: string; own: boolean } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("20:00");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!target) return;
    setStart(target.start);
    setEnd(target.end);
    setError(null);
  }, [target]);

  const save = async (reset = false) => {
    if (!target) return;
    if (!reset && toMin(end) - toMin(start) < 30) return setError("O fim precisa ser pelo menos 30 minutos depois do início.");
    setSaving(true);
    setError(null);
    try {
      await api.put("/api/team-agenda/hours", { userId: target.userId, start: reset ? null : start, end: reset ? null : end });
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const team = !target?.userId;
  return (
    <Dialog
      open={!!target}
      onOpenChange={(v) => !v && !saving && onClose()}
      size="sm"
      title={team ? "Horário de atendimento da equipe" : `Horário de atendimento · ${target?.name ?? ""}`}
      description={team ? "Vale para quem não tem um horário próprio. Os horários livres só aparecem dentro dele." : "Os horários livres desta pessoa só aparecem dentro deste horário."}
      footer={
        <>
          {!team && target?.own && (
            <Button variant="secondary" onClick={() => save(true)} disabled={saving} className="sm:mr-auto">
              Usar o da equipe
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => save()} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Começa a atender" htmlFor="wh-start">
          <Input id="wh-start" type="time" step={1800} value={start} onChange={(e) => setStart(e.target.value)} required />
        </Field>
        <Field label="Para de atender" htmlFor="wh-end">
          <Input id="wh-end" type="time" step={1800} value={end} onChange={(e) => setEnd(e.target.value)} required />
        </Field>
      </div>
      {error && (
        <p className="mt-3 text-[13.5px] text-danger" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}

/** Quem está livre e ocupado no dia, para marcar sem conflito. Mostra o horário de cada compromisso, nunca o nome. */
export function AvailabilityView({ date, onDate, onPick }: { date: string; onDate: (d: string) => void; onPick: (date: string, time: string, userId: string) => void }) {
  const me = useMe();
  const { data, error, isLoading, mutate } = useSWR<Availability>(`/api/team-agenda/availability${qs({ date })}`, fetcher, { keepPreviousData: true });
  const [editing, setEditing] = useState<{ userId?: string; name: string; start: string; end: string; own: boolean } | null>(null);
  const today = todayKey();

  // Faixa comum a todos: do primeiro início ao último fim de atendimento (em horas cheias).
  const from = data ? Math.min(...data.people.map((p) => Math.floor(toMin(p.workStart) / 60)), Math.floor(toMin(data.workStart) / 60)) : 8;
  const to = data ? Math.max(...data.people.map((p) => Math.ceil(toMin(p.workEnd) / 60)), Math.ceil(toMin(data.workEnd) / 60)) : 20;

  return (
    <div className="flex flex-col gap-4">
      <div className="anim-rise flex flex-wrap items-center justify-between gap-2">
        <h2 className={cx("text-[18px] font-semibold", date === today && "text-brand")}>{dayTitle(date)}</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => onDate(today)} className="h-10 rounded-[12px] px-3 text-[14px] font-medium hover:bg-white">
            Hoje
          </button>
          <button onClick={() => onDate(prevKey(date))} className="flex size-10 items-center justify-center rounded-[12px] hover:bg-white" aria-label="Dia anterior">
            <ChevronLeft className="size-5" />
          </button>
          <button onClick={() => onDate(nextKey(date))} className="flex size-10 items-center justify-center rounded-[12px] hover:bg-white" aria-label="Próximo dia">
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>

      {error && !data ? (
        <Card>
          <ErrorState error={error} onRetry={() => mutate()} />
        </Card>
      ) : isLoading && !data ? (
        <LoadingState rows={5} />
      ) : data ? (
        <>
          <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-medium text-ink ring-1 ring-line">
              <Clock className="size-3.5 text-brand" aria-hidden />
              Equipe atende das {data.workStart} às {data.workEnd}
              {data.canEditTeam && (
                <button
                  onClick={() => setEditing({ name: "Equipe", start: data.workStart, end: data.workEnd, own: false })}
                  className="ml-1 inline-flex items-center gap-1 font-semibold text-brand hover:underline"
                >
                  <Pencil className="size-3" aria-hidden /> Mudar
                </button>
              )}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-brand" /> no CRM
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[#9aa8b1]" /> no Google Agenda
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[#e3f5ec] ring-1 ring-line" /> livre
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[repeating-linear-gradient(135deg,#eef1f2_0_2px,#d5dcdf_2px_4px)] ring-1 ring-line" /> fora do horário
            </span>
          </div>
          <ul className="flex flex-col gap-3">
            {data.people.map((p, i) => {
              const canEdit = p.userId === me.user.id || data.canEditTeam;
              return (
                <li key={p.userId} className="anim-rise" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                  <Card className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      <TeamAvatar userId={p.userId} name={p.name} size={40} />
                      <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-52px)]">
                        <p className="truncate text-[15.5px] font-semibold">{p.userId === me.user.id ? `${p.name} (você)` : p.name}</p>
                        <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
                          <span className="text-ink">
                            <Clock className="mr-1 inline size-3.5 align-[-2px] text-muted" aria-hidden />
                            Atende das {p.workStart} às {p.workEnd}
                            {!p.ownHours && <span className="text-muted"> (da equipe)</span>}
                          </span>
                          {canEdit && (
                            <button
                              onClick={() => setEditing({ userId: p.userId, name: p.name.split(" ")[0], start: p.workStart, end: p.workEnd, own: p.ownHours })}
                              className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
                            >
                              <Pencil className="size-3" aria-hidden /> Mudar
                            </button>
                          )}
                          <span aria-hidden>·</span>
                          {p.google === "connected" ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <CalendarCheck className="size-3.5" aria-hidden /> Google Agenda conectado
                            </span>
                          ) : p.google === "error" ? (
                            <span className="inline-flex items-center gap-1 text-danger">
                              <CircleAlert className="size-3.5" aria-hidden /> Google Agenda com problema, conectar de novo
                            </span>
                          ) : (
                            <span>Sem Google Agenda: mostra só o que está no CRM</span>
                          )}
                        </p>
                      </div>
                      <span className={cx("rounded-full px-3 py-1 text-[13px] font-semibold max-sm:ml-[52px]", p.count ? "bg-info-soft text-info" : "bg-selected text-brand-dark")}>
                        {p.count === 0 ? "Nenhum compromisso" : `${p.count} compromisso${p.count > 1 ? "s" : ""}`}
                        {p.allDay > 0 && ` · ${p.allDay} dia inteiro`}
                      </span>
                    </div>
                    <div className="mt-3">
                      <Timeline date={data.date} from={from} to={to} work={[p.workStart, p.workEnd]} busy={p.busy} />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 w-[92px] text-[12.5px] font-medium text-muted">Compromissos:</span>
                      {p.busy.length === 0 ? (
                        <span className="text-[13px] text-muted">{p.allDay ? "só compromisso de dia inteiro" : "nenhum neste dia"}</span>
                      ) : (
                        p.busy.map((b, k) => (
                          <span
                            key={k}
                            className={cx(
                              "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold",
                              b.source === "google" ? "bg-[#eceff1] text-[#3d4a52]" : "bg-selected text-brand-dark",
                            )}
                            title={b.source === "google" ? "Ocupado no Google Agenda" : "Ocupado no CRM"}
                          >
                            <span className={cx("size-2 rounded-full", b.source === "google" ? "bg-[#9aa8b1]" : "bg-brand")} aria-hidden />
                            {formatTime(b.start)}–{formatTime(b.end)}
                          </span>
                        ))
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 w-[92px] text-[12.5px] font-medium text-muted">Livre:</span>
                      {p.free.length === 0 ? (
                        <span className="text-[13px] text-muted">sem horário livre no horário de atendimento</span>
                      ) : (
                        p.free.map((s) => {
                          const past = new Date(s.end).getTime() < Date.now();
                          return (
                            <button
                              key={s.start}
                              disabled={past}
                              onClick={() => onPick(data.date, localInputs(s.start).time, p.userId)}
                              className="inline-flex h-8 items-center gap-1 rounded-full border border-line bg-white px-3 text-[13px] font-medium hover:border-brand hover:bg-selected disabled:opacity-40"
                              title="Marcar compromisso neste horário"
                            >
                              <CalendarPlus className="size-3.5 text-brand" aria-hidden />
                              {formatTime(s.start)}–{formatTime(s.end)} <span className="font-normal text-muted">({duration(s)})</span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
          <p className="text-center text-[12.5px] text-muted">Toque num horário livre para marcar um compromisso já com o dia, a hora e a pessoa.</p>
        </>
      ) : null}
      <HoursDialog target={editing} onClose={() => setEditing(null)} onSaved={() => mutate()} />
    </div>
  );
}
