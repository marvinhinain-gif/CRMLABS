"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { CalendarClock, CalendarX, Check, ExternalLink, Mail, MapPin, Megaphone, MessageCircle, Phone, SquareUser, UserX, Video, X } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { useMe } from "@/lib/me";
import { formatBRL, formatDateTime, formatPhone, formatTime, longDayTime, relativeTime, whatsappLink } from "@/lib/format";
import { Avatar, Badge, Button, cx, ErrorState, LoadingState, Sheet, SheetClose } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";
import { ScheduleDialog, type ScheduleValues } from "./ScheduleDialog";

export const APPT_STATUS = {
  scheduled: { label: "Agendada", cls: "bg-selected text-brand" },
  done: { label: "Realizada", cls: "bg-success-soft text-success" },
  no_show: { label: "Não compareceu", cls: "bg-warning-soft text-warning" },
  canceled: { label: "Cancelada", cls: "bg-[#eef2f1] text-[#46565f]" },
} as const;

const SOURCE: Record<string, string> = { manual: "Cadastro manual", instagram_dm: "Direct do Instagram", instagram_comment: "Comentário no Instagram", import: "Importação", lead_form: "Formulário de anúncio" };

type Detail = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  status: keyof typeof APPT_STATUS;
  location: string | null;
  notes: string | null;
  ownerId: string | null;
  ownerName: string | null;
  contact: { id: string; name: string; phone: string | null; email: string | null; username: string | null; avatarUrl: string | null; summary: string | null; source: string; ownerId: string | null; ownerName: string | null; tags: string[]; createdAt: string } | null;
  lead: { id: string; answers: { label: string; value: string }[]; utm: Record<string, string>; preferredAt: string | null; preferredText: string | null; createdAt: string; formName: string | null; channel: string } | null;
  opportunity: { id: string; title: string; valueCents: number; status: string } | null;
  history: { id: string; startsAt: string; status: keyof typeof APPT_STATUS; title: string }[];
};

function Section({ title, children, icon }: { title: string; children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-[14.5px]">{children}</dd>
    </div>
  );
}

function Body({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const me = useMe();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: a, error, mutate } = useSWR<Detail>(`/api/appointments/${id}`, fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} className="p-6" />;
  if (!a) return <LoadingState rows={6} className="p-6" />;

  const refresh = async () => {
    await mutate();
    onChanged();
    await globalMutate((k) => typeof k === "string" && (k.startsWith("/api/leads") || k.startsWith("/api/dashboard")));
  };
  const setStatus = async (status: keyof typeof APPT_STATUS, msg: string) => {
    if (status === "canceled" && !confirm("Cancelar esta reunião?")) return;
    setBusy(status);
    try {
      await api.patch(`/api/appointments/${a.id}`, { status });
      await refresh();
      toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const reschedule = async (v: ScheduleValues) => {
    await api.patch(`/api/appointments/${a.id}`, { startsAt: v.startsAt, endsAt: v.endsAt, title: v.title, location: v.location ?? undefined, notes: v.notes ?? undefined, status: "scheduled" });
    await refresh();
    toast.success("Reunião remarcada.");
  };

  const c = a.contact;
  const first = c?.name.split(" ")[0] ?? "";
  const wa = whatsappLink(c?.phone, `Olá, ${first}! Passando para confirmar nossa reunião ${longDayTime(a.startsAt).replace(" · ", " às ")}. Tudo certo?`);
  const st = APPT_STATUS[a.status];
  const isLink = a.location && /^https?:\/\//.test(a.location);
  const minutes = Math.round((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000);
  const utm = Object.entries(a.lead?.utm ?? {});

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="border-b border-line px-5 pb-4 pt-5 sm:px-6">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <span className={cx("inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium", st.cls)}>{st.label}</span>
            <h2 className="mt-2 text-[21px] font-semibold leading-tight">{longDayTime(a.startsAt)}</h2>
            <p className="mt-0.5 text-[13.5px] text-muted">
              até {formatTime(a.endsAt)} · {minutes} min · {a.title}
            </p>
          </div>
          <SheetClose asChild>
            <button className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page" aria-label="Fechar" onClick={onClose}>
              <X className="size-5" />
            </button>
          </SheetClose>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px]">
          {a.ownerName && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-page px-3 py-1">
              <TeamAvatar userId={a.ownerId} name={a.ownerName} size={20} /> com {a.ownerId === me.user.id ? "você" : a.ownerName}
            </span>
          )}
          {a.location &&
            (isLink ? (
              <a href={a.location} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-3 py-1 font-medium text-info hover:underline">
                <Video className="size-4" aria-hidden /> Entrar na chamada
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-page px-3 py-1">
                <MapPin className="size-4" aria-hidden /> {a.location}
              </span>
            ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
        {c && (
          <>
            <div className="flex items-center gap-3">
              <Avatar name={c.name} src={c.avatarUrl} size={52} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-semibold">{c.name}</p>
                <p className="truncate text-[13px] text-muted">
                  {SOURCE[c.source] ?? c.source} · cliente desde {relativeTime(c.createdAt).toLowerCase()}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              <a href={wa ?? undefined} target="_blank" rel="noreferrer" className={cx("flex flex-col items-center gap-1 rounded-[16px] border px-2 py-3 text-[13px] font-medium", wa ? "border-[#bfe8d3] bg-[#e9f9f1] text-[#0f7a4f]" : "pointer-events-none border-line text-muted opacity-50")}>
                <MessageCircle className="size-5" aria-hidden /> WhatsApp
              </a>
              <a href={c.phone ? `tel:${c.phone}` : undefined} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line px-2 py-3 text-[13px] font-medium hover:bg-page", !c.phone && "pointer-events-none opacity-50")}>
                <Phone className="size-5" aria-hidden /> Ligar
              </a>
              <a href={c.email ? `mailto:${c.email}` : undefined} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line px-2 py-3 text-[13px] font-medium hover:bg-page", !c.email && "pointer-events-none opacity-50")}>
                <Mail className="size-5" aria-hidden /> E-mail
              </a>
            </div>
            <Section title="Cliente">
              <dl className="divide-y divide-line">
                {c.phone && <Item label="WhatsApp">{formatPhone(c.phone)}</Item>}
                {c.email && <Item label="E-mail">{c.email}</Item>}
                {c.username && (
                  <Item label="Instagram">
                    <a href={`https://www.instagram.com/${c.username}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                      <InstagramGlyph size={16} /> @{c.username}
                    </a>
                  </Item>
                )}
                <Item label="Social seller">{c.ownerName ?? "—"}</Item>
                {c.summary && <Item label="Resumo">{c.summary}</Item>}
                {c.tags.length > 0 && (
                  <Item label="Tags">
                    <span className="flex flex-wrap gap-1.5">
                      {c.tags.map((t) => (
                        <Badge key={t}>{t}</Badge>
                      ))}
                    </span>
                  </Item>
                )}
              </dl>
            </Section>
          </>
        )}

        {a.notes && (
          <Section title="Observações da reunião">
            <p className="whitespace-pre-wrap rounded-[14px] bg-page/70 px-4 py-3 text-[14.5px]">{a.notes}</p>
          </Section>
        )}

        {a.lead && (
          <Section title={`Formulário do anúncio${a.lead.formName ? ` · ${a.lead.formName}` : ""}`} icon={<Megaphone className="size-4" aria-hidden />}>
            <p className="text-[12.5px] text-muted">Preenchido em {formatDateTime(a.lead.createdAt)}</p>
            <dl className="divide-y divide-line">
              {a.lead.answers.map((x, i) => (
                <Item key={i} label={x.label}>
                  {x.value}
                </Item>
              ))}
              {(a.lead.preferredAt || a.lead.preferredText) && <Item label="Horário que o cliente sugeriu">{a.lead.preferredAt ? longDayTime(a.lead.preferredAt) : a.lead.preferredText}</Item>}
            </dl>
            {utm.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {utm.map(([k, v]) => (
                  <span key={k} className="rounded-full bg-page px-3 py-1 text-[12.5px]">
                    <span className="text-muted">{k.replace("utm_", "")}:</span> {v}
                  </span>
                ))}
              </div>
            )}
            <Link href={`/leads?lead=${a.lead.id}`} className="mt-2 inline-flex items-center gap-1 text-[13.5px] font-semibold text-brand hover:underline">
              Ver lead <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          </Section>
        )}

        {a.opportunity && (
          <Section title="Oportunidade">
            <p className="text-[14.5px]">
              <b>{a.opportunity.title}</b> · {formatBRL(Number(a.opportunity.valueCents))} · {a.opportunity.status === "won" ? "ganha" : a.opportunity.status === "lost" ? "perdida" : "aberta"}
            </p>
          </Section>
        )}

        {a.history.length > 0 && (
          <Section title="Outras reuniões com este cliente">
            <ul className="flex flex-col gap-1.5">
              {a.history.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 text-[13.5px]">
                  <span className="truncate">
                    {formatDateTime(h.startsAt)} · {h.title}
                  </span>
                  <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[12px]", APPT_STATUS[h.status].cls)}>{APPT_STATUS[h.status].label}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {c && (
          <Link href={`?contato=${c.id}`} className="mt-6 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand hover:underline">
            <SquareUser className="size-4" aria-hidden /> Abrir ficha completa do contato
          </Link>
        )}
      </div>

      <footer className="border-t border-line bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        {a.status === "scheduled" ? (
          <div className="grid grid-cols-2 gap-2">
            <Button loading={busy === "done"} icon={<Check className="size-4" />} onClick={() => setStatus("done", "Reunião marcada como realizada.")}>
              Realizada
            </Button>
            <Button variant="secondary" loading={busy === "no_show"} icon={<UserX className="size-4" />} onClick={() => setStatus("no_show", "Registrado: cliente não compareceu.")}>
              Não veio
            </Button>
            <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setRescheduling(true)}>
              Remarcar
            </Button>
            <Button variant="ghost" loading={busy === "canceled"} icon={<CalendarX className="size-4" />} onClick={() => setStatus("canceled", "Reunião cancelada.")}>
              Cancelar
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" icon={<CalendarClock className="size-4" />} onClick={() => setRescheduling(true)}>
              Remarcar
            </Button>
            <Button variant="ghost" loading={busy === "scheduled"} onClick={() => setStatus("scheduled", "Reunião reaberta.")}>
              Voltar para agendada
            </Button>
          </div>
        )}
      </footer>
      <ScheduleDialog
        open={rescheduling}
        onOpenChange={setRescheduling}
        title="Remarcar reunião"
        subtitle={c ? `Com ${c.name}` : undefined}
        suggested={a.startsAt}
        defaultTitle={a.title}
        showOwner={false}
        submitLabel="Salvar novo horário"
        onSubmit={reschedule}
      />
    </div>
  );
}

export function AgendaSheet({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  return (
    <Sheet open={!!id} onOpenChange={(v) => !v && onClose()} title="Reunião" width={540}>
      {id && <Body id={id} onClose={onClose} onChanged={onChanged} />}
    </Sheet>
  );
}
