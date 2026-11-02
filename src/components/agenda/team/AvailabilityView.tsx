"use client";

import useSWR from "swr";
import { CalendarCheck, CalendarPlus, ChevronLeft, ChevronRight, CircleAlert } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { useMe } from "@/lib/me";
import { formatTime, localInputs } from "@/lib/format";
import { Card, cx, ErrorState, LoadingState } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { dayTitle, nextKey, todayKey } from "../calendarGrid";

type Slot = { start: string; end: string };
type Person = {
  userId: string;
  name: string;
  google: "connected" | "not_connected" | "error";
  count: number;
  allDay: number;
  busy: (Slot & { source: "crm" | "google" })[];
  free: Slot[];
};
type Availability = { date: string; workStart: number; workEnd: number; people: Person[] };

const prevKey = (key: string) => localInputs(new Date(new Date(`${key}T12:00:00-03:00`).getTime() - 86400000)).date;

function duration(s: Slot) {
  const min = Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60000);
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, "0") : ""}`;
}

/** Faixa do expediente com os horários ocupados (sem o nome do compromisso). */
function Timeline({ date, start, end, busy }: { date: string; start: number; end: number; busy: Person["busy"] }) {
  const t0 = new Date(`${date}T${String(start).padStart(2, "0")}:00:00-03:00`).getTime();
  const span = (end - start) * 3600000;
  const pct = (t: string) => Math.min(100, Math.max(0, ((new Date(t).getTime() - t0) / span) * 100));
  const now = Date.now();
  const nowPct = date === todayKey() && now > t0 && now < t0 + span ? ((now - t0) / span) * 100 : null;
  return (
    <div>
      <div className="relative h-7 overflow-hidden rounded-[10px] bg-[#e3f5ec]" role="img" aria-label={`${busy.length} horário(s) ocupado(s)`}>
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
      <div className="mt-1 flex justify-between text-[11px] text-muted" aria-hidden>
        {Array.from({ length: (end - start) / 2 + 1 }, (_, i) => start + i * 2).map((h) => (
          <span key={h}>{h}h</span>
        ))}
      </div>
    </div>
  );
}

/** Quem está livre e ocupado no dia, para marcar sem conflito. Mostra só ocupado/livre, nunca o nome do compromisso. */
export function AvailabilityView({ date, onDate, onPick }: { date: string; onDate: (d: string) => void; onPick: (date: string, time: string, userId: string) => void }) {
  const me = useMe();
  const { data, error, isLoading, mutate } = useSWR<Availability>(`/api/team-agenda/availability${qs({ date })}`, fetcher, { keepPreviousData: true });
  const today = todayKey();

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
          <p className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-brand" /> ocupado no CRM
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[#9aa8b1]" /> ocupado no Google Agenda
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-[#e3f5ec] ring-1 ring-line" /> livre
            </span>
            <span>
              Expediente das {data.workStart}h às {data.workEnd}h · toque num horário livre para marcar
            </span>
          </p>
          <ul className="flex flex-col gap-3">
            {data.people.map((p, i) => (
              <li key={p.userId} className="anim-rise" style={{ "--i": Math.min(i, 8) } as React.CSSProperties}>
                <Card className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <TeamAvatar userId={p.userId} name={p.name} size={40} />
                    <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-52px)]">
                      <p className="truncate text-[15.5px] font-semibold">{p.userId === me.user.id ? `${p.name} (você)` : p.name}</p>
                      <p className="flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
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
                    <Timeline date={data.date} start={data.workStart} end={data.workEnd} busy={p.busy} />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[12.5px] font-medium text-muted">Livre:</span>
                    {p.free.length === 0 ? (
                      <span className="text-[13px] text-muted">sem horário livre no expediente</span>
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
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
