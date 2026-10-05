"use client";

import { useEffect, useState } from "react";
import { CalendarCheck } from "lucide-react";
import { useMe, useTeam } from "@/lib/me";
import { fromLocalInputs, localInputs, longDayTime } from "@/lib/format";
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
