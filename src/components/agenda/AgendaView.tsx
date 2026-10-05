"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CalendarDays, ChevronLeft, ChevronRight, List, Megaphone, Video } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { dayKey, formatPhone, formatTime, TZ } from "@/lib/format";
import { Avatar, Card, cx, EmptyState, ErrorState, LoadingState, PageHeader, Select, Tabs } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { AgendaSheet, APPT_STATUS } from "./AgendaSheet";

export type AgendaItem = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: keyof typeof APPT_STATUS;
  location: string | null;
  ownerId: string | null;
  ownerName: string | null;
  contactId: string;
  contactName: string;
  contactPhone: string | null;
  contactUsername: string | null;
  contactAvatar: string | null;
  leadId: string | null;
  fromLead: boolean;
};

const WEEK = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Dia de hoje no fuso da operação, como "YYYY-MM-DD". */
const todayKey = () => dayKey(new Date());
const keyOf = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const startIso = (key: string) => new Date(`${key}T00:00:00-03:00`).toISOString();

function monthGrid(y: number, m: number) {
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

function dayTitle(key: string) {
  const d = new Date(`${key}T12:00:00-03:00`);
  const label = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(d);
  const t = todayKey();
  const tomorrow = dayKey(new Date(Date.now() + 86400000));
  return key === t ? `Hoje · ${label}` : key === tomorrow ? `Amanhã · ${label}` : label.charAt(0).toUpperCase() + label.slice(1);
}

function MeetingRow({ a, i, onOpen }: { a: AgendaItem; i: number; onOpen: () => void }) {
  const st = APPT_STATUS[a.status];
  const past = new Date(a.endsAt).getTime() < Date.now();
  return (
    <li className="anim-fade" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
      <button onClick={onOpen} className={cx("group flex w-full items-stretch gap-3 rounded-[18px] border bg-white p-3 text-left transition-[box-shadow,transform] hover:shadow-[var(--shadow-pop)] sm:p-4", a.status === "canceled" ? "border-line opacity-60" : "border-line/80")}>
        <span className={cx("flex w-[62px] shrink-0 flex-col items-center justify-center rounded-[14px] py-2", past && a.status === "scheduled" ? "bg-warning-soft text-warning" : "bg-selected text-brand")}>
          <span className="text-[17px] font-bold leading-none">{formatTime(a.startsAt)}</span>
          <span className="mt-1 text-[11.5px] opacity-80">{Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000)} min</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <Avatar name={a.contactName} src={a.contactAvatar} size={26} />
            <span className={cx("truncate text-[15.5px] font-semibold", a.status === "canceled" && "line-through")}>{a.contactName}</span>
            {a.fromLead && <Megaphone className="size-4 shrink-0 text-brand" aria-label="Veio de anúncio" />}
          </span>
          <span className="mt-1 block truncate text-[13px] text-muted">{[a.title, formatPhone(a.contactPhone)].filter(Boolean).join(" · ")}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            <span className={cx("rounded-full px-2 py-0.5 font-medium", st.cls)}>{past && a.status === "scheduled" ? "Aguardando resultado" : st.label}</span>
            {a.ownerName && (
              <span className="inline-flex items-center gap-1.5 text-muted">
                <TeamAvatar userId={a.ownerId} name={a.ownerName} size={18} /> {a.ownerName}
              </span>
            )}
            {a.location && /^https?:\/\//.test(a.location) && (
              <span className="inline-flex items-center gap-1 text-muted">
                <Video className="size-3.5" aria-hidden /> online
              </span>
            )}
          </span>
        </span>
        <ChevronRight className="my-auto size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </button>
    </li>
  );
}

export function AgendaView() {
  const me = useMe();
  const team = useTeam();
  const [view, setView] = useQueryParam("ver", "mes");
  const [month, setMonth] = useQueryParam("mes", todayKey().slice(0, 7));
  const [selected, setSelected] = useQueryParam("dia", todayKey());
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [meetingId, setMeetingId] = useQueryParam("reuniao", "");
  const [y, m] = month.split("-").map(Number);
  const grid = useMemo(() => monthGrid(y, m - 1), [y, m]);

  // Mês: a grade inteira; lista: hoje + 60 dias.
  const range =
    view === "lista"
      ? { from: startIso(todayKey()), to: startIso(dayKey(new Date(Date.now() + 60 * 86400000))) }
      : { from: startIso(grid[0].key), to: new Date(new Date(startIso(grid[grid.length - 1].key)).getTime() + 86400000).toISOString() };
  const { data, error, isLoading, mutate } = useSWR<AgendaItem[]>(`/api/agenda${qs({ ...range, ownerId: owner })}`, fetcher, { keepPreviousData: true });

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const a of data ?? []) {
      const k = dayKey(a.startsAt);
      map.set(k, [...(map.get(k) ?? []), a]);
    }
    return map;
  }, [data]);

  const shift = (d: number) => {
    const nd = new Date(Date.UTC(y, m - 1 + d, 1));
    setMonth(`${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}`);
  };
  const goToday = () => {
    setMonth(todayKey().slice(0, 7));
    setSelected(todayKey());
  };
  const today = todayKey();
  const upcoming = (data ?? []).filter((a) => a.status !== "canceled");
  const scheduledCount = (data ?? []).filter((a) => a.status === "scheduled" && new Date(a.startsAt).getTime() > Date.now()).length;

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title="Agendamentos"
        subtitle={`${scheduledCount} reunião(ões) por vir ${view === "lista" ? "nos próximos 60 dias" : "neste mês"}.`}
        actions={
          <>
            {me.permissions.dataAll && (
              <Select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="min-w-[160px] flex-1 sm:flex-none sm:w-[200px] bg-white">
                <option value="">Toda a equipe</option>
                {team
                  .filter((x) => x.status === "active")
                  .map((x) => (
                    <option key={x.userId} value={x.userId}>
                      {x.name}
                    </option>
                  ))}
              </Select>
            )}
            <Tabs
              value={view as "mes" | "lista"}
              onChange={(v) => setView(v)}
              items={[
                { value: "mes", label: "Calendário", icon: <CalendarDays /> },
                { value: "lista", label: "Lista", icon: <List /> },
              ]}
            />
          </>
        }
      />

      {error && !data ? (
        <Card>
          <ErrorState error={error} onRetry={() => mutate()} />
        </Card>
      ) : isLoading && !data ? (
        <LoadingState rows={5} />
      ) : view === "lista" ? (
        upcoming.length === 0 ? (
          <Card>
            <EmptyState icon={<CalendarDays />} title="Nenhuma reunião nos próximos 60 dias" description="Confirme reuniões a partir dos Leads ou pelo painel de um contato." />
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {[...byDay.entries()]
              .filter(([, items]) => items.some((a) => a.status !== "canceled"))
              .map(([k, items], gi) => (
                <section key={k} className="anim-rise" style={{ "--i": gi } as React.CSSProperties}>
                  <h2 className={cx("mb-2 text-[15px] font-semibold", k === today ? "text-brand" : "text-ink")}>{dayTitle(k)}</h2>
                  <ul className="flex flex-col gap-2">
                    {items.map((a, i) => (
                      <MeetingRow key={a.id} a={a} i={i} onOpen={() => setMeetingId(a.id)} />
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)] [&>*]:min-w-0">
          <Card className="anim-rise p-3 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2 px-1">
              <h2 className="text-[19px] font-semibold capitalize">
                {MONTHS[m - 1]} <span className="font-normal text-muted">{y}</span>
              </h2>
              <div className="flex items-center gap-1">
                <button onClick={goToday} className="h-10 rounded-[12px] px-3 text-[14px] font-medium hover:bg-page">
                  Hoje
                </button>
                <button onClick={() => shift(-1)} className="flex size-10 items-center justify-center rounded-[12px] hover:bg-page" aria-label="Mês anterior">
                  <ChevronLeft className="size-5" />
                </button>
                <button onClick={() => shift(1)} className="flex size-10 items-center justify-center rounded-[12px] hover:bg-page" aria-label="Próximo mês">
                  <ChevronRight className="size-5" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] text-center text-[12px] font-medium uppercase tracking-wide text-muted">
              {WEEK.map((w) => (
                <div key={w} className="pb-2">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5" role="grid" aria-label="Calendário de reuniões">
              {grid.map((c) => {
                const items = (byDay.get(c.key) ?? []).filter((a) => a.status !== "canceled");
                const isSel = c.key === selected;
                const isToday = c.key === today;
                return (
                  <button
                    key={c.key}
                    role="gridcell"
                    aria-selected={isSel}
                    aria-label={`${c.day}${items.length ? `, ${items.length} reunião(ões)` : ""}`}
                    onClick={() => setSelected(c.key)}
                    className={cx(
                      "relative flex min-h-[54px] flex-col items-center rounded-[14px] border p-1 text-left transition-colors sm:min-h-[96px] sm:items-stretch sm:p-1.5",
                      isSel ? "border-brand bg-selected" : "border-transparent hover:bg-page",
                      !c.inMonth && "opacity-40",
                    )}
                  >
                    <span className={cx("flex size-7 items-center justify-center rounded-full text-[13.5px] font-semibold sm:self-start", isToday ? "bg-brand text-white" : "text-ink")}>{c.day}</span>
                    {/* Celular: pontinhos. Telas maiores: horário e nome. */}
                    {items.length > 0 && (
                      <span className="mt-1 flex gap-0.5 sm:hidden" aria-hidden>
                        {items.slice(0, 3).map((a) => (
                          <span key={a.id} className={cx("size-1.5 rounded-full", a.fromLead ? "bg-brand-accent" : "bg-info")} />
                        ))}
                      </span>
                    )}
                    <span className="mt-1 hidden flex-col gap-0.5 sm:flex">
                      {items.slice(0, 2).map((a) => (
                        <span key={a.id} className={cx("truncate rounded-[7px] px-1.5 py-0.5 text-[11.5px] font-medium", a.fromLead ? "bg-[#d6f3e5] text-brand-dark" : "bg-info-soft text-info")}>
                          {formatTime(a.startsAt)} {a.contactName.split(" ")[0]}
                        </span>
                      ))}
                      {items.length > 2 && <span className="px-1.5 text-[11px] text-muted">+{items.length - 2} mais</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-1 text-[12px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-brand-accent" /> veio de anúncio
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-info" /> outras reuniões
              </span>
            </p>
          </Card>

          <section className="anim-rise flex flex-col gap-3" style={{ "--i": 1 } as React.CSSProperties} aria-live="polite">
            <h2 className={cx("text-[17px] font-semibold", selected === today && "text-brand")}>{dayTitle(selected)}</h2>
            {(byDay.get(selected) ?? []).length === 0 ? (
              <Card className="py-2">
                <EmptyState icon={<CalendarDays />} title="Nenhuma reunião neste dia" description="Toque em outro dia do calendário." className="py-8" />
              </Card>
            ) : (
              <ul key={selected} className="flex flex-col gap-2">
                {(byDay.get(selected) ?? []).map((a, i) => (
                  <MeetingRow key={a.id} a={a} i={i} onOpen={() => setMeetingId(a.id)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <AgendaSheet id={meetingId || null} onClose={() => setMeetingId(null)} onChanged={() => mutate()} />
    </div>
  );
}
