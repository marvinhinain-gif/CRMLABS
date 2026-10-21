"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { CalendarPlus, Check, TriangleAlert } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { dayKey, formatTime, fromLocalInputs, localInputs } from "@/lib/format";
import { Button, cx, Dialog, Field, Input, Select, Switch, Textarea } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { ContactPicker, type PickedContact } from "@/components/contacts/ContactPicker";
import { nextKey, startIso } from "../calendarGrid";
import { REMINDERS, type TeamEventDetail, type TeamItem } from "./types";

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];
const durLabel = (d: number) => (d < 60 ? `${d} min` : `${Math.floor(d / 60)}h${d % 60 ? ` ${d % 60}` : ""}`);

/** Marcar (ou editar) um compromisso com pessoas da equipe. */
export function EventDialog({
  open,
  onOpenChange,
  editing,
  defaultDate,
  defaultPeople,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing?: TeamEventDetail | null;
  defaultDate: string;
  defaultPeople: string[];
  onSaved: (id: string) => void;
}) {
  const me = useMe();
  const team = useTeam();
  const people = useMemo(
    () => team.filter((m) => m.status === "active").sort((a, b) => (a.userId === me.user.id ? -1 : b.userId === me.user.id ? 1 : a.name.localeCompare(b.name))),
    [team, me.user.id],
  );
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [allDay, setAllDay] = useState(false);
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState("");
  const [contact, setContact] = useState<PickedContact | null>(null);
  const [reminder, setReminder] = useState("30");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editing) {
      const s = localInputs(editing.startsAt);
      setTitle(editing.title);
      setChosen(editing.participants.map((p) => p.userId));
      setAllDay(editing.allDay);
      setDate(s.date);
      setEndDate(dayKey(new Date(new Date(editing.endsAt).getTime() - 1)));
      setTime(editing.allDay ? "10:00" : s.time);
      const min = Math.round((new Date(editing.endsAt).getTime() - new Date(editing.startsAt).getTime()) / 60000);
      setDuration(editing.allDay ? 60 : min);
      setLocation(editing.location ?? "");
      setContact(editing.contact ? { id: editing.contact.id, name: editing.contact.name } : null);
      setReminder(editing.reminderMinutes == null ? "" : String(editing.reminderMinutes));
      setNotes(editing.description ?? "");
    } else {
      setTitle("");
      setChosen([...new Set([me.user.id, ...defaultPeople])]);
      setAllDay(false);
      setDate(defaultDate);
      setEndDate(defaultDate);
      setTime("10:00");
      setDuration(60);
      setLocation("");
      setContact(null);
      setReminder("30");
      setNotes("");
    }
  }, [open, editing, defaultDate, defaultPeople, me.user.id]);

  const range = useMemo(() => {
    if (!date) return null;
    if (allDay) {
      const last = endDate && endDate >= date ? endDate : date;
      return { start: startIso(date), end: startIso(nextKey(last)) };
    }
    if (!time) return null;
    const start = fromLocalInputs(date, time);
    return { start, end: new Date(new Date(start).getTime() + duration * 60000).toISOString() };
  }, [date, endDate, time, duration, allDay]);

  // Quem já tem algo nesse horário (compromissos da equipe e reuniões com clientes).
  const { data: dayItems } = useSWR<TeamItem[]>(open && date ? `/api/team-agenda${qs({ from: startIso(date), to: startIso(nextKey(allDay && endDate > date ? endDate : date)) })}` : null, fetcher);
  const conflicts = useMemo(() => {
    if (!range || !dayItems) return [];
    const s = new Date(range.start).getTime();
    const e = new Date(range.end).getTime();
    const out: { name: string; item: TeamItem }[] = [];
    for (const it of dayItems) {
      if (it.canceled || it.id === editing?.id || it.allDay) continue;
      if (!(new Date(it.startsAt).getTime() < e && new Date(it.endsAt).getTime() > s)) continue;
      for (const uid of it.participantIds) if (chosen.includes(uid)) out.push({ name: people.find((p) => p.userId === uid)?.name ?? "", item: it });
    }
    return out;
  }, [range, dayItems, chosen, editing?.id, people]);

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!title.trim()) return setError("Dê um nome ao compromisso.");
    if (!chosen.length) return setError("Escolha ao menos uma pessoa.");
    if (!range) return setError("Escolha o dia e o horário.");
    if (allDay && endDate && endDate < date) return setError("O último dia precisa ser depois do primeiro.");
    setSaving(true);
    setError(null);
    const body = {
      title: title.trim(),
      participantIds: chosen,
      allDay,
      startsAt: range.start,
      endsAt: range.end,
      location: location.trim() || null,
      contactId: contact?.id ?? null,
      reminderMinutes: reminder === "" ? null : Number(reminder),
      description: notes.trim() || null,
    };
    try {
      const saved = editing ? await api.patch<{ id: string }>(`/api/team-agenda/${editing.id}`, body) : await api.post<{ id: string }>("/api/team-agenda", body);
      onSaved(saved.id);
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const others = chosen.filter((id) => id !== me.user.id).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      title={editing ? "Editar compromisso" : "Marcar compromisso"}
      description={editing ? "Quem participa é avisado da mudança." : "Cada pessoa escolhida recebe o compromisso na agenda dela e uma notificação."}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="team-event-form" loading={saving} icon={<CalendarPlus className="size-4" />}>
            {editing ? "Salvar" : others ? "Marcar e avisar" : "Marcar"}
          </Button>
        </>
      }
    >
      <form id="team-event-form" onSubmit={submit} className="flex flex-col gap-4">
        <Field label="O que é" htmlFor="ev-title">
          <Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Ex.: Alinhamento semanal, treinamento, conversa 1:1" autoFocus />
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-[13.5px] font-medium text-ink">Com quem</legend>
          <div className="flex flex-wrap gap-1.5">
            {people.map((p) => {
              const on = chosen.includes(p.userId);
              return (
                <button
                  key={p.userId}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(p.userId)}
                  className={cx(
                    "inline-flex h-10 items-center gap-2 rounded-full border pl-1 pr-3 text-[13.5px] font-medium transition-colors",
                    on ? "border-brand bg-selected text-brand-dark" : "border-line bg-white text-ink hover:bg-page",
                  )}
                >
                  <TeamAvatar userId={p.userId} name={p.name} size={30} />
                  {p.userId === me.user.id ? "Eu" : p.name.split(" ")[0]}
                  {on && <Check className="size-4" aria-hidden />}
                </button>
              );
            })}
          </div>
        </fieldset>

        <Switch checked={allDay} onChange={setAllDay} label="Dia inteiro" description="Folga, viagem, evento externo…" />

        {allDay ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primeiro dia" htmlFor="ev-date">
              <Input
                id="ev-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  if (endDate < e.target.value) setEndDate(e.target.value);
                }}
                required
              />
            </Field>
            <Field label="Último dia" htmlFor="ev-end">
              <Input id="ev-end" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} required />
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1fr]">
            <Field label="Dia" htmlFor="ev-date" className="col-span-2 sm:col-span-1">
              <Input id="ev-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
            <Field label="Horário" htmlFor="ev-time">
              <Input id="ev-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
            </Field>
            <Field label="Duração" htmlFor="ev-dur">
              <Select id="ev-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
                {[...new Set([...DURATIONS, duration])]
                  .sort((a, b) => a - b)
                  .map((d) => (
                    <option key={d} value={d}>
                      {durLabel(d)}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
        )}

        {conflicts.length > 0 && (
          <div className="anim-fade rounded-[14px] bg-warning-soft px-4 py-3 text-[13px] text-[#6b4a00]" role="status">
            <p className="flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="size-4" aria-hidden /> Já tem compromisso nesse horário
            </p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {conflicts.slice(0, 5).map((c, i) => (
                <li key={i}>
                  {c.name.split(" ")[0]}: {c.item.title} ({formatTime(c.item.startsAt)}–{formatTime(c.item.endsAt)})
                </li>
              ))}
            </ul>
          </div>
        )}

        <Field label="Local ou link da chamada" htmlFor="ev-loc" hint="Opcional. Ex.: sala, endereço ou link do Google Meet.">
          <Input id="ev-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="https://meet.google.com/…" />
        </Field>

        <Field label="Lead ou contato relacionado" hint="Opcional.">
          <ContactPicker value={contact} onChange={setContact} />
        </Field>

        <Field label="Lembrete" htmlFor="ev-rem">
          <Select id="ev-rem" value={reminder} onChange={(e) => setReminder(e.target.value)}>
            {REMINDERS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Observações" htmlFor="ev-notes">
          <Textarea id="ev-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Pauta, o que levar, contexto…" />
        </Field>

        {error && (
          <p className="text-[13.5px] text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
