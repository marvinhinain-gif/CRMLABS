"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Bell, CalendarX, MapPin, Pencil, SquareUser, Video, X } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { useOpenContact } from "@/lib/nav";
import { formatDate, formatTime, longDayTime, relativeTime } from "@/lib/format";
import { Button, cx, ErrorState, LoadingState, Sheet, SheetClose } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { todayKey } from "../calendarGrid";
import { EventDialog } from "./EventDialog";
import { isLink, reminderLabel, type TeamEventDetail } from "./types";

function whenText(e: TeamEventDetail) {
  if (e.allDay) {
    const a = formatDate(e.startsAt);
    const b = formatDate(new Date(new Date(e.endsAt).getTime() - 1));
    return { main: a === b ? a : `${a} a ${b}`, sub: "Dia inteiro" };
  }
  const min = Math.round((new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 60000);
  return { main: longDayTime(e.startsAt), sub: `até ${formatTime(e.endsAt)} · ${min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}` : ""}`}` };
}

function Body({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const me = useMe();
  const openContact = useOpenContact();
  const { data: e, error, mutate } = useSWR<TeamEventDetail>(`/api/team-agenda/${id}`, fetcher);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} className="p-6" />;
  if (!e) return <LoadingState rows={5} className="p-6" />;

  const w = whenText(e);
  const past = new Date(e.endsAt).getTime() < Date.now();
  const cancel = async () => {
    if (!confirm("Cancelar este compromisso? Quem participa será avisado.")) return;
    setBusy(true);
    try {
      await api.del(`/api/team-agenda/${e.id}`);
      toast.success("Compromisso cancelado. A equipe foi avisada.");
      await mutate();
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line px-5 pb-4 pt-5 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span
              className={cx(
                "inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium",
                e.canceledAt ? "bg-[#eef2f1] text-[#46565f]" : past ? "bg-page text-muted" : "bg-selected text-brand",
              )}
            >
              {e.canceledAt ? "Cancelado" : past ? "Já aconteceu" : "Compromisso da equipe"}
            </span>
            <h2 className={cx("mt-2 text-[21px] font-semibold leading-tight", e.canceledAt && "line-through opacity-70")}>{e.title}</h2>
            <p className="mt-0.5 text-[14px] text-ink">{w.main}</p>
            <p className="text-[13px] text-muted">{w.sub}</p>
          </div>
          <SheetClose asChild>
            <button className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page" aria-label="Fechar" onClick={onClose}>
              <X className="size-5" />
            </button>
          </SheetClose>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]">
          {e.location &&
            (isLink(e.location) ? (
              <a href={e.location} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-3 py-1 font-medium text-info hover:underline">
                <Video className="size-4" aria-hidden /> Entrar na chamada
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-page px-3 py-1">
                <MapPin className="size-4" aria-hidden /> {e.location}
              </span>
            ))}
          {!e.canceledAt && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-page px-3 py-1 text-muted">
              <Bell className="size-4" aria-hidden /> {reminderLabel(e.reminderMinutes)}
            </span>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
        <section>
          <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Quem participa</h3>
          <ul className="flex flex-col gap-1">
            {e.participants.map((p) => (
              <li key={p.userId} className="flex items-center gap-3 rounded-[14px] px-1 py-1.5">
                <TeamAvatar userId={p.userId} name={p.name} size={36} />
                <span className="text-[15px] font-medium">{p.userId === me.user.id ? `${p.name} (você)` : p.name}</span>
              </li>
            ))}
          </ul>
        </section>

        {e.contact && (
          <section className="mt-6">
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Lead ou contato</h3>
            <button onClick={() => openContact(e.contact!.id)} className="flex w-full items-center gap-3 rounded-[16px] border border-line px-3 py-2.5 text-left hover:bg-page">
              <SquareUser className="size-5 text-brand" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium">{e.contact.name}</span>
              {e.contact.username && <span className="text-[12.5px] text-muted">@{e.contact.username}</span>}
            </button>
          </section>
        )}

        {e.description && (
          <section className="mt-6">
            <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted">Observações</h3>
            <p className="whitespace-pre-wrap break-words text-[14.5px]">{e.description}</p>
          </section>
        )}

        <p className="mt-6 text-[12.5px] text-muted">
          Marcado por {e.createdBy === me.user.id ? "você" : (e.createdByName ?? "—")} · {relativeTime(e.createdAt).toLowerCase()}
        </p>
      </div>

      {e.canEdit && !e.canceledAt && (
        <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
          <Button variant="secondary" icon={<CalendarX className="size-4" />} onClick={cancel} loading={busy}>
            Cancelar compromisso
          </Button>
          <Button icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>
            Editar
          </Button>
        </footer>
      )}

      <EventDialog
        open={editing}
        onOpenChange={setEditing}
        editing={e}
        defaultDate={todayKey()}
        defaultPeople={[]}
        onSaved={async () => {
          toast.success("Compromisso atualizado.");
          await mutate();
          onChanged();
        }}
      />
    </div>
  );
}

export function EventSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()} title="Compromisso" width={500}>
      {id && <Body id={id} onClose={onClose} onChanged={onChanged} />}
    </Sheet>
  );
}
