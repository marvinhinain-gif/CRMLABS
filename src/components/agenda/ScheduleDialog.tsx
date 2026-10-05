"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { CalendarCheck, TriangleAlert } from "lucide-react";
import { fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { formatTime, fromLocalInputs, localInputs, longDayTime } from "@/lib/format";
import { Button, Dialog, Field, Input, Select, Textarea } from "@/components/ui";

export type ScheduleValues = { startsAt: string; endsAt: string; ownerId: string | null; title: string; location: string | null; notes: string | null };

const DURATIONS = [30, 45, 60, 90, 120];

/** Escolher dia, horário, duração e com quem será a reunião. */
export function ScheduleDialog({
  open,
  onOpenChange,
  title = "Confirmar reunião",
  subtitle,
  suggested,
  defaultTitle,
  defaultOwnerId,
  showOwner = true,
  submitLabel = "Confirmar reunião",
  excludeId,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title?: string;
  subtitle?: string;
  suggested?: string | null;
  defaultTitle: string;
  defaultOwnerId?: string | null;
  showOwner?: boolean;
  submitLabel?: string;
  /** Reunião sendo remarcada (não conta como conflito com ela mesma). */
  excludeId?: string;
  onSubmit: (v: ScheduleValues) => Promise<void>;
}) {
  const me = useMe();
  const team = useTeam();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [ownerId, setOwnerId] = useState<string>("");
  const [name, setName] = useState(defaultTitle);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const base = suggested && new Date(suggested).getTime() > Date.now() ? suggested : null;
    if (base) {
      const l = localInputs(base);
      setDate(l.date);
      setTime(l.time);
    } else {
      const t = new Date(Date.now() + 86400000);
      setDate(localInputs(t).date);
      setTime("10:00");
    }
    setOwnerId(defaultOwnerId ?? me.user.id);
    setName(defaultTitle);
    setLocation("");
    setNotes("");
    setError(null);
  }, [open, suggested, defaultTitle, defaultOwnerId, me.user.id]);

  // Horários ocupados de quem vai atender (CRM + Google Agenda, se conectada).
  const busyKey = open && date && (ownerId || me.user.id) ? `/api/calendar/busy${qs({ ownerId: ownerId || me.user.id, date, excludeId })}` : null;
  const { data: busy } = useSWR<{ ownerName: string; google: string; busy: { start: string; end: string; source: "crm" | "google"; label?: string }[] }>(busyKey, fetcher);
  const chosenStart = date && time ? new Date(fromLocalInputs(date, time)).getTime() : null;
  const chosenEnd = chosenStart ? chosenStart + duration * 60000 : null;
  const conflict = chosenStart && chosenEnd ? busy?.busy.find((b) => new Date(b.start).getTime() < chosenEnd && new Date(b.end).getTime() > chosenStart) : undefined;

  // Social seller: marca para si ou para um closer. Gestores: qualquer pessoa ativa.
  const owners = team.filter((m) => m.status === "active" && (me.permissions.assign || m.userId === me.user.id || m.role === "closer"));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !time) return setError("Escolha o dia e o horário.");
    const startsAt = fromLocalInputs(date, time);
    if (new Date(startsAt).getTime() < Date.now() - 5 * 60000) return setError("Escolha um horário futuro.");
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        startsAt,
        endsAt: new Date(new Date(startsAt).getTime() + duration * 60000).toISOString(),
        ownerId: ownerId || null,
        title: name.trim() || defaultTitle,
        location: location.trim() || null,
        notes: notes.trim() || null,
      });
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      title={title}
      description={subtitle}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form="schedule-form" loading={saving} icon={<CalendarCheck className="size-4" />}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={submit} className="flex flex-col gap-4">
        {suggested && (
          <p className="rounded-[14px] bg-selected px-4 py-2.5 text-[13.5px] text-brand-dark">
            Horário sugerido pelo cliente: <b>{longDayTime(suggested)}</b>
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_1fr]">
          <Field label="Dia" htmlFor="sch-date" className="col-span-2 sm:col-span-1">
            <Input id="sch-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
          <Field label="Horário" htmlFor="sch-time">
            <Input id="sch-time" type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} required />
          </Field>
          <Field label="Duração" htmlFor="sch-dur">
            <Select id="sch-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {DURATIONS.map((d) => (
                <option key={d} value={d}>
                  {d < 60 ? `${d} min` : `${d / 60}h${d % 60 ? ` ${d % 60}` : ""}`}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {showOwner && (
          <Field label="Quem faz a reunião" htmlFor="sch-owner">
            <Select id="sch-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              {owners.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userId === me.user.id ? `Eu (${m.name})` : `${m.name}${m.role === "closer" ? " · closer" : ""}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {busy && (busy.busy.length > 0 || busy.google !== "not_connected") && (
          <div className={`anim-fade rounded-[14px] px-4 py-3 text-[13px] ${conflict ? "bg-warning-soft text-[#6b4a00]" : "bg-page/70 text-muted"}`}>
            {conflict ? (
              <p className="flex items-center gap-1.5 font-semibold">
                <TriangleAlert className="size-4" aria-hidden /> {busy.ownerName.split(" ")[0]} já tem compromisso nesse horário ({formatTime(conflict.start)}–{formatTime(conflict.end)}).
              </p>
            ) : (
              <p className="font-medium text-ink">{busy.ownerName.split(" ")[0]} neste dia:</p>
            )}
            {busy.busy.length === 0 ? (
              <p className="mt-0.5">Livre o dia todo{busy.google === "connected" ? " (Google Agenda conferida)" : ""}.</p>
            ) : (
              <p className="mt-1 flex flex-wrap gap-1.5">
                {busy.busy.map((b, i) => (
                  <span key={i} className="rounded-full bg-white px-2.5 py-0.5 text-[12.5px] text-ink">
                    Ocupado {formatTime(b.start)}–{formatTime(b.end)}
                    {b.source === "google" ? " · Google" : ""}
                  </span>
                ))}
              </p>
            )}
          </div>
        )}
        <Field label="Título" htmlFor="sch-title">
          <Input id="sch-title" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </Field>
        <Field label="Local ou link da chamada" htmlFor="sch-loc" hint="Ex.: link do Google Meet, Zoom ou endereço.">
          <Input id="sch-loc" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} placeholder="https://meet.google.com/…" />
        </Field>
        <Field label="Observações" htmlFor="sch-notes">
          <Textarea id="sch-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="O que combinar, o que levar, contexto do cliente…" />
        </Field>
        {error && <p className="text-[13.5px] text-danger" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
