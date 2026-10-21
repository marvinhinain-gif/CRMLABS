"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, List, Lock, MapPin, SquareUser, Users, Video } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { dayKey, formatTime } from "@/lib/format";
import { Button, Card, cx, EmptyState, ErrorState, LoadingState, PageHeader, Tabs } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { dayTitle, monthGrid, MONTHS, nextKey, startIso, todayKey, WEEK } from "../calendarGrid";
import { EventDialog } from "./EventDialog";
import { EventSheet } from "./EventSheet";
import { isLink, type TeamItem } from "./types";

const ALL = "equipe";

/** Dias (chaves) em que o item aparece: o dia do início, ou todos os dias de um compromisso de dia inteiro. */
function daysOf(it: TeamItem) {
  const first = dayKey(it.startsAt);
  if (!it.allDay) return [first];
  const last = dayKey(new Date(new Date(it.endsAt).getTime() - 1));
  const out = [first];
  for (let k = first; k < last && out.length < 40; ) out.push((k = nextKey(k)));
  return out;
}

function chipTone(it: TeamItem) {
  if (it.kind === "meeting") return it.restricted ? "bg-page text-muted" : "bg-info-soft text-info";
  return "bg-[#d6f3e5] text-brand-dark";
}

function Faces({ ids, max = 4 }: { ids: string[]; max?: number }) {
  const team = useTeam();
  return (
    <span className="flex -space-x-1">
      {ids.slice(0, max).map((id) => (
        <TeamAvatar key={id} userId={id} name={team.find((m) => m.userId === id)?.name} size={24} className="ring-2 ring-white" />
      ))}
      {ids.length > max && <span className="flex size-6 items-center justify-center rounded-full bg-page text-[10.5px] font-semibold ring-2 ring-white">+{ids.length - max}</span>}
    </span>
  );
}

function ItemRow({ it, i, showPeople, onOpen }: { it: TeamItem; i: number; showPeople: boolean; onOpen?: () => void }) {
  const min = Math.round((new Date(it.endsAt).getTime() - new Date(it.startsAt).getTime()) / 60000);
  const past = new Date(it.endsAt).getTime() < Date.now();
  const Tag = onOpen ? "button" : "div";
  return (
    <li className="anim-fade" style={{ "--i": Math.min(i, 10) } as React.CSSProperties}>
      <Tag
        {...(onOpen ? { onClick: onOpen } : {})}
        className={cx(
          "group flex w-full items-stretch gap-3 rounded-[18px] border bg-white p-3 text-left sm:p-4",
          onOpen && "transition-[box-shadow,transform] hover:shadow-[var(--shadow-pop)]",
          it.canceled || it.restricted ? "border-line opacity-70" : "border-line/80",
        )}
      >
        <span className={cx("flex w-[62px] shrink-0 flex-col items-center justify-center rounded-[14px] py-2", it.kind === "meeting" ? "bg-info-soft text-info" : past ? "bg-page text-muted" : "bg-selected text-brand")}>
          {it.allDay ? (
            <span className="text-center text-[12.5px] font-semibold leading-tight">Dia inteiro</span>
          ) : (
            <>
              <span className="text-[17px] font-bold leading-none">{formatTime(it.startsAt)}</span>
              <span className="mt-1 text-[11.5px] opacity-80">{min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? `${min % 60}` : ""}`}</span>
            </>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("flex items-center gap-1.5 truncate text-[15.5px] font-semibold", it.canceled && "line-through")}>
            {it.restricted && <Lock className="size-4 shrink-0 text-muted" aria-hidden />}
            <span className="truncate">{it.title}</span>
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
            {it.kind === "meeting" ? (
              <span className="rounded-full bg-info-soft px-2 py-0.5 font-medium text-info">{it.restricted ? "Ocupado" : "Reunião com cliente"}</span>
            ) : it.canceled ? (
              <span className="rounded-full bg-[#eef2f1] px-2 py-0.5 font-medium text-[#46565f]">Cancelado</span>
            ) : null}
            {showPeople && <Faces ids={it.participantIds} />}
            {it.contactName && (
              <span className="inline-flex min-w-0 items-center gap-1 text-muted">
                <SquareUser className="size-3.5 shrink-0" aria-hidden /> <span className="truncate">{it.contactName}</span>
              </span>
            )}
            {it.location && (
              <span className="inline-flex min-w-0 items-center gap-1 text-muted">
                {isLink(it.location) ? <Video className="size-3.5 shrink-0" aria-hidden /> : <MapPin className="size-3.5 shrink-0" aria-hidden />}
                <span className="truncate">{isLink(it.location) ? "online" : it.location}</span>
              </span>
            )}
          </span>
        </span>
        {onOpen && <ChevronRight className="my-auto size-5 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />}
      </Tag>
    </li>
  );
}

/** Agenda da equipe: cada pessoa tem a sua; dá para marcar compromissos com uma ou mais pessoas. */
export function TeamAgendaView() {
  const me = useMe();
  const team = useTeam();
  const router = useRouter();
  const [person, setPerson] = useQueryParam("pessoa", me.user.id);
  const [view, setView] = useQueryParam("ver", "mes");
  const [month, setMonth] = useQueryParam("mes", todayKey().slice(0, 7));
  const [selected, setSelected] = useQueryParam("dia", todayKey());
  const [eventId, setEventId] = useQueryParam("compromisso", "");
  const [creating, setCreating] = useState(false);
  const [y, m] = month.split("-").map(Number);
  const grid = useMemo(() => monthGrid(y, m - 1), [y, m]);
  const people = useMemo(
    () => team.filter((x) => x.status === "active").sort((a, b) => (a.userId === me.user.id ? -1 : b.userId === me.user.id ? 1 : a.name.localeCompare(b.name))),
    [team, me.user.id],
  );
  const whole = person === ALL;
  const personName = whole ? null : person === me.user.id ? "Sua agenda" : `Agenda de ${people.find((p) => p.userId === person)?.name.split(" ")[0] ?? "…"}`;

  const range =
    view === "lista"
      ? { from: startIso(todayKey()), to: startIso(dayKey(new Date(Date.now() + 60 * 86400000))) }
      : { from: startIso(grid[0].key), to: startIso(nextKey(grid[grid.length - 1].key)) };
  const { data, error, isLoading, mutate } = useSWR<TeamItem[]>(`/api/team-agenda${qs({ ...range, userId: whole ? "" : person })}`, fetcher, { keepPreviousData: true });

  const byDay = useMemo(() => {
    const map = new Map<string, TeamItem[]>();
    for (const it of data ?? []) for (const k of daysOf(it)) map.set(k, [...(map.get(k) ?? []), it]);
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
  const open = (it: TeamItem) => (it.kind === "event" ? () => setEventId(it.id) : it.restricted ? undefined : () => router.push(`/agendamentos?reuniao=${it.id}`));
  const upcoming = (data ?? []).filter((it) => !it.canceled && new Date(it.endsAt).getTime() > Date.now()).length;
  const dayItems = byDay.get(selected) ?? [];

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageHeader
        title="Agenda da equipe"
        subtitle={`${whole ? "Toda a equipe" : personName} · ${upcoming} compromisso(s) por vir ${view === "lista" ? "nos próximos 60 dias" : "neste mês"}.`}
        actions={
          <>
            <Tabs
              value={view as "mes" | "lista"}
              onChange={(v) => setView(v)}
              items={[
                { value: "mes", label: "Calendário", icon: <CalendarDays /> },
                { value: "lista", label: "Lista", icon: <List /> },
              ]}
            />
            <Button icon={<CalendarPlus className="size-4" />} onClick={() => setCreating(true)}>
              Marcar compromisso
            </Button>
          </>
        }
      />

      {/* De quem é a agenda: cada pessoa tem a sua. */}
      <nav aria-label="Agenda de quem" className="anim-rise -mx-4 overflow-x-auto px-4 scroll-thin sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-2 pb-1">
          {people.map((p) => {
            const on = person === p.userId;
            return (
              <li key={p.userId}>
                <button
                  onClick={() => setPerson(p.userId)}
                  aria-pressed={on}
                  className={cx("inline-flex h-11 items-center gap-2 rounded-full border pl-1.5 pr-4 text-[14px] font-medium transition-colors", on ? "border-brand bg-selected text-brand-dark" : "border-line bg-white hover:bg-page")}
                >
                  <TeamAvatar userId={p.userId} name={p.name} size={32} />
                  {p.userId === me.user.id ? "Minha agenda" : p.name.split(" ")[0]}
                </button>
              </li>
            );
          })}
          <li>
            <button
              onClick={() => setPerson(ALL)}
              aria-pressed={whole}
              className={cx("inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-medium transition-colors", whole ? "border-brand bg-selected text-brand-dark" : "border-line bg-white hover:bg-page")}
            >
              <Users className="size-[18px]" aria-hidden /> Toda a equipe
            </button>
          </li>
        </ul>
      </nav>

      {error && !data ? (
        <Card>
          <ErrorState error={error} onRetry={() => mutate()} />
        </Card>
      ) : isLoading && !data ? (
        <LoadingState rows={5} />
      ) : view === "lista" ? (
        upcoming === 0 ? (
          <Card>
            <EmptyState
              icon={<CalendarDays />}
              title="Nada marcado nos próximos 60 dias"
              description="Marque um compromisso e a pessoa recebe na agenda dela, com notificação."
              action={
                <Button icon={<CalendarPlus className="size-4" />} onClick={() => setCreating(true)}>
                  Marcar compromisso
                </Button>
              }
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            {[...byDay.entries()]
              .sort(([a], [b]) => a.localeCompare(b))
              .filter(([k, items]) => k >= today && items.some((it) => !it.canceled))
              .map(([k, items], gi) => (
                <section key={k} className="anim-rise" style={{ "--i": Math.min(gi, 8) } as React.CSSProperties}>
                  <h2 className={cx("mb-2 text-[15px] font-semibold", k === today ? "text-brand" : "text-ink")}>{dayTitle(k)}</h2>
                  <ul className="flex flex-col gap-2">
                    {items.map((it, i) => (
                      <ItemRow key={`${it.kind}-${it.id}`} it={it} i={i} showPeople={whole || it.participantIds.length > 1} onOpen={open(it)} />
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
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5" role="grid" aria-label="Calendário da agenda">
              {grid.map((c) => {
                const items = (byDay.get(c.key) ?? []).filter((it) => !it.canceled);
                const isSel = c.key === selected;
                const isToday = c.key === today;
                return (
                  <button
                    key={c.key}
                    role="gridcell"
                    aria-selected={isSel}
                    aria-label={`${c.day}${items.length ? `, ${items.length} compromisso(s)` : ""}`}
                    onClick={() => setSelected(c.key)}
                    onDoubleClick={() => {
                      setSelected(c.key);
                      setCreating(true);
                    }}
                    className={cx(
                      "relative flex min-h-[54px] flex-col items-center rounded-[14px] border p-1 text-left transition-colors sm:min-h-[96px] sm:items-stretch sm:p-1.5",
                      isSel ? "border-brand bg-selected" : "border-transparent hover:bg-page",
                      !c.inMonth && "opacity-40",
                    )}
                  >
                    <span className={cx("flex size-7 items-center justify-center rounded-full text-[13.5px] font-semibold sm:self-start", isToday ? "bg-brand text-white" : "text-ink")}>{c.day}</span>
                    {items.length > 0 && (
                      <span className="mt-1 flex gap-0.5 sm:hidden" aria-hidden>
                        {items.slice(0, 3).map((it) => (
                          <span key={`${it.kind}-${it.id}`} className={cx("size-1.5 rounded-full", it.kind === "meeting" ? "bg-info" : "bg-brand-accent")} />
                        ))}
                      </span>
                    )}
                    <span className="mt-1 hidden flex-col gap-0.5 sm:flex">
                      {items.slice(0, 2).map((it) => (
                        <span key={`${it.kind}-${it.id}`} className={cx("truncate rounded-[7px] px-1.5 py-0.5 text-[11.5px] font-medium", chipTone(it))}>
                          {it.allDay ? "" : `${formatTime(it.startsAt)} `}
                          {it.title}
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
                <span className="size-2 rounded-full bg-brand-accent" /> compromissos da equipe
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-info" /> reuniões com clientes
              </span>
            </p>
          </Card>

          <section className="anim-rise flex flex-col gap-3" style={{ "--i": 1 } as React.CSSProperties} aria-live="polite">
            <div className="flex items-center justify-between gap-2">
              <h2 className={cx("text-[17px] font-semibold", selected === today && "text-brand")}>{dayTitle(selected)}</h2>
              <Button size="sm" variant="soft" icon={<CalendarPlus className="size-4" />} onClick={() => setCreating(true)}>
                Marcar neste dia
              </Button>
            </div>
            {dayItems.length === 0 ? (
              <Card className="py-2">
                <EmptyState icon={<CalendarDays />} title={whole ? "Ninguém tem compromisso neste dia" : "Dia livre"} description="Toque em outro dia do calendário ou marque um compromisso." className="py-8" />
              </Card>
            ) : (
              <ul key={selected} className="flex flex-col gap-2">
                {dayItems.map((it, i) => (
                  <ItemRow key={`${it.kind}-${it.id}`} it={it} i={i} showPeople={whole || it.participantIds.length > 1} onOpen={open(it)} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <EventDialog
        open={creating}
        onOpenChange={setCreating}
        defaultDate={view === "mes" && selected >= today ? selected : today}
        defaultPeople={whole ? [] : [person]}
        onSaved={(id) => {
          toast.success("Compromisso marcado. Quem participa foi avisado.");
          void mutate();
          setEventId(id);
        }}
      />
      <EventSheet id={eventId || null} onClose={() => setEventId(null)} onChanged={() => mutate()} />
    </div>
  );
}
