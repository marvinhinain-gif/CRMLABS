"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Ban, CalendarCheck, CalendarClock, Check, ExternalLink, Mail, MessageCircle, Phone, PhoneOff, SquareUser, X } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { formatDateTime, formatPhone, longDayTime, relativeTime, whatsappLink } from "@/lib/format";
import { Avatar, Button, cx, ErrorState, LoadingState, Select, Sheet, SheetClose } from "@/components/ui";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";
import { ScheduleDialog, type ScheduleValues } from "@/components/agenda/ScheduleDialog";
import { JourneySection, OriginTrail, type Journey } from "@/components/integrations/Journey";

export const LEAD_STATUS = {
  new: { label: "Novo", cls: "bg-brand text-white" },
  contacted: { label: "Em contato", cls: "bg-info-soft text-info" },
  no_answer: { label: "Sem resposta", cls: "bg-warning-soft text-warning" },
  scheduled: { label: "Reunião marcada", cls: "bg-success-soft text-success" },
  disqualified: { label: "Descartado", cls: "bg-[#eef2f1] text-[#46565f]" },
} as const;

const UTM_LABEL: Record<string, string> = {
  utm_source: "Origem",
  utm_medium: "Mídia",
  utm_campaign: "Campanha",
  utm_content: "Anúncio",
  utm_term: "Termo",
  campaign_name: "Campanha",
  adset_name: "Conjunto",
  ad_name: "Anúncio",
  platform: "Plataforma",
  form_name: "Formulário (Meta)",
};

type LeadDetail = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  instagram: string | null;
  status: keyof typeof LEAD_STATUS;
  answers: { label: string; value: string }[];
  preferredAt: string | null;
  preferredText: string | null;
  utm: Record<string, string>;
  channel: string;
  createdAt: string;
  contactedAt: string | null;
  assignedTo: string | null;
  assignedName: string | null;
  formName: string | null;
  contactId: string;
  contact: { id: string; name: string; avatarUrl: string | null; username: string | null } | null;
  appointment: { id: string; startsAt: string; endsAt: string; status: string; title: string; ownerName: string | null; location: string | null } | null;
  previous: { id: string; createdAt: string; formName: string | null }[];
  source: { name: string; color: string } | null;
  productName: string | null;
  campaign: string | null;
  adChannel: string | null;
  partner: string | null;
  adName: string | null;
  customValues: { label: string; value: string }[];
  journey: Journey | null;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5">
      <dt className="text-[12.5px] text-muted">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-[14.5px] text-ink">{children}</dd>
    </div>
  );
}

function Body({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useMe();
  const team = useTeam();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: l, error, mutate } = useSWR<LeadDetail>(`/api/leads/${id}`, fetcher);
  const [busy, setBusy] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  if (error) return <ErrorState error={error} onRetry={() => mutate()} className="p-6" />;
  if (!l) return <LoadingState rows={6} className="p-6" />;

  const refresh = async () => {
    await mutate();
    await globalMutate((k) => typeof k === "string" && (k.startsWith("/api/leads") || k.startsWith("/api/me") || k.startsWith("/api/agenda")));
  };
  const patch = async (body: Record<string, unknown>, msg: string, key: string) => {
    setBusy(key);
    try {
      await api.patch(`/api/leads/${l.id}`, body);
      await refresh();
      toast.success(msg);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const schedule = async (v: ScheduleValues) => {
    await api.post(`/api/leads/${l.id}/schedule`, v);
    await refresh();
    toast.success("Reunião confirmada! Ela já aparece em Agendamentos.");
  };

  const first = l.name.split(" ")[0];
  const wa = whatsappLink(l.phone, `Olá, ${first}! Aqui é ${me.user.name.split(" ")[0]}, da ${me.org.name}. Recebi seu cadastro e quero combinar um horário para conversarmos.`);
  const st = LEAD_STATUS[l.status];
  const utm = Object.entries(l.utm ?? {});
  const open = l.status !== "scheduled" && l.status !== "disqualified";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-start gap-3 border-b border-line px-5 pb-4 pt-5 sm:px-6">
        <Avatar name={l.name} src={l.contact?.avatarUrl} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[20px] font-semibold leading-tight">{l.name}</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {l.formName ?? (l.channel === "webhook" ? "Recebido por integração" : "Formulário removido")} · {relativeTime(l.createdAt)}
          </p>
          <span className={cx("mt-2 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-medium", st.cls)}>{st.label}</span>
        </div>
        <SheetClose asChild>
          <button className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-page" aria-label="Fechar" onClick={onClose}>
            <X className="size-5" />
          </button>
        </SheetClose>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
        {/* Contato rápido */}
        <div className="grid grid-cols-3 gap-2">
          <a
            href={wa ?? undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!wa}
            onClick={() => wa && l.status === "new" && patch({ status: "contacted" }, "Marcado como em contato.", "auto")}
            className={cx("flex flex-col items-center gap-1 rounded-[16px] border px-2 py-3 text-[13px] font-medium transition-colors", wa ? "border-[#bfe8d3] bg-[#e9f9f1] text-[#0f7a4f] hover:brightness-[0.98]" : "pointer-events-none border-line text-muted opacity-50")}
          >
            <MessageCircle className="size-5" aria-hidden /> WhatsApp
          </a>
          <a href={l.phone ? `tel:${l.phone}` : undefined} aria-disabled={!l.phone} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line bg-white px-2 py-3 text-[13px] font-medium hover:bg-page", !l.phone && "pointer-events-none opacity-50")}>
            <Phone className="size-5" aria-hidden /> Ligar
          </a>
          <a href={l.email ? `mailto:${l.email}` : undefined} aria-disabled={!l.email} className={cx("flex flex-col items-center gap-1 rounded-[16px] border border-line bg-white px-2 py-3 text-[13px] font-medium hover:bg-page", !l.email && "pointer-events-none opacity-50")}>
            <Mail className="size-5" aria-hidden /> E-mail
          </a>
        </div>

        {l.appointment && (
          <Link href={`/agendamentos?reuniao=${l.appointment.id}`} className="mt-4 flex items-center gap-3 rounded-[18px] border border-[#c9ebdc] bg-selected p-4 hover:brightness-[0.99]">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-white text-brand" aria-hidden>
              <CalendarCheck className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-semibold text-brand-dark">{longDayTime(l.appointment.startsAt)}</span>
              <span className="block truncate text-[12.5px] text-brand-dark/80">
                {l.appointment.title} · com {l.appointment.ownerName ?? "—"}
                {l.appointment.status === "canceled" ? " · cancelada" : ""}
              </span>
            </span>
            <ExternalLink className="size-4 text-brand" aria-hidden />
          </Link>
        )}

        {(l.preferredAt || l.preferredText) && l.status !== "scheduled" && (
          <div className="mt-4 flex items-center gap-3 rounded-[18px] border border-line p-4">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-warning-soft text-warning" aria-hidden>
              <CalendarClock className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[12.5px] text-muted">Melhor horário para o cliente</span>
              <span className="block text-[15px] font-semibold">{l.preferredAt ? longDayTime(l.preferredAt) : l.preferredText}</span>
            </span>
          </div>
        )}

        <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-muted">Origem</h3>
        <div className="mt-2 rounded-[16px] border border-line p-3.5">
          <OriginTrail source={l.source} parts={[l.adChannel, l.partner, l.campaign, l.formName]} at={l.createdAt} />
          {l.adName && <p className="mt-1.5 text-[12.5px] text-muted">Conteúdo / anúncio: {l.adName}</p>}
        </div>

        <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-muted">Formulário / Aplicação{l.formName ? ` · ${l.formName}` : ""}</h3>
        <dl className="mt-1 divide-y divide-line">
          {l.productName && <Row label="Produto de interesse">{l.productName}</Row>}
          {l.customValues.map((c) => (
            <Row key={c.label} label={c.label}>
              {c.value}
            </Row>
          ))}
          <Row label="Nome">{l.name}</Row>
          {l.phone && <Row label="WhatsApp">{formatPhone(l.phone)}</Row>}
          {l.email && <Row label="E-mail">{l.email}</Row>}
          {l.instagram && (
            <Row label="Instagram">
              <a href={`https://www.instagram.com/${l.instagram}/`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-brand hover:underline">
                <InstagramGlyph size={16} /> @{l.instagram}
              </a>
            </Row>
          )}
          {l.answers.map((a, i) => (
            <Row key={i} label={a.label}>
              {a.value}
            </Row>
          ))}
        </dl>

        {utm.length > 0 && (
          <>
            <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-muted">Parâmetros do anúncio (UTM)</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {utm.map(([k, v]) => (
                <span key={k} className="rounded-full bg-page px-3 py-1 text-[12.5px]">
                  <span className="text-muted">{UTM_LABEL[k] ?? k}:</span> {v}
                </span>
              ))}
            </div>
          </>
        )}

        <h3 className="mt-6 text-[13px] font-semibold uppercase tracking-wide text-muted">Atendimento</h3>
        <dl className="mt-1 divide-y divide-line">
          <Row label="Responsável (social seller)">
            {me.permissions.assign ? (
              <Select aria-label="Responsável" value={l.assignedTo ?? ""} onChange={(e) => patch({ assignedTo: e.target.value || null }, "Lead repassado.", "assign")} className="mt-1 max-w-[280px]">
                <option value="">Sem responsável</option>
                {team
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            ) : (
              (l.assignedName ?? "—")
            )}
          </Row>
          <Row label="Recebido em">{formatDateTime(l.createdAt)}</Row>
          {l.contactedAt && <Row label="Primeiro contato">{formatDateTime(l.contactedAt)}</Row>}
          {l.previous.length > 0 && <Row label="Já preencheu antes">{l.previous.map((p) => `${formatDateTime(p.createdAt)}${p.formName ? ` · ${p.formName}` : ""}`).join("\n")}</Row>}
        </dl>
        <div className="mt-6">
          <JourneySection contactId={l.contactId} initial={l.journey} />
        </div>
        <Link href={`?contato=${l.contactId}`} className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand hover:underline">
          <SquareUser className="size-4" aria-hidden /> Abrir ficha completa do contato
        </Link>
      </div>

      <footer className="border-t border-line bg-white px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
        {open ? (
          <div className="flex flex-col gap-2">
            <Button size="lg" className="w-full" icon={<CalendarCheck className="size-5" />} onClick={() => setScheduling(true)}>
              Confirmar reunião
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="secondary" loading={busy === "contacted"} disabled={l.status === "contacted"} icon={<Check className="size-4" />} onClick={() => patch({ status: "contacted" }, "Marcado como em contato.", "contacted")}>
                Falei
              </Button>
              <Button size="sm" variant="secondary" loading={busy === "no_answer"} disabled={l.status === "no_answer"} icon={<PhoneOff className="size-4" />} onClick={() => patch({ status: "no_answer" }, "Marcado como sem resposta.", "no_answer")}>
                Sem resposta
              </Button>
              <Button size="sm" variant="ghost" loading={busy === "disqualified"} icon={<Ban className="size-4" />} onClick={() => patch({ status: "disqualified" }, "Lead descartado.", "disqualified")}>
                Descartar
              </Button>
            </div>
          </div>
        ) : l.status === "disqualified" ? (
          <Button variant="secondary" className="w-full" loading={busy === "reopen"} onClick={() => patch({ status: "contacted" }, "Lead reaberto.", "reopen")}>
            Reabrir lead
          </Button>
        ) : (
          <Link href={l.appointment ? `/agendamentos?reuniao=${l.appointment.id}` : "/agendamentos"} className="flex h-12 items-center justify-center gap-2 rounded-[14px] border border-[#c9ebdc] bg-selected text-[15px] font-semibold text-brand">
            <CalendarCheck className="size-5" aria-hidden /> Ver em Agendamentos
          </Link>
        )}
      </footer>

      <ScheduleDialog
        open={scheduling}
        onOpenChange={setScheduling}
        subtitle={`Com ${l.name}${l.phone ? ` · ${formatPhone(l.phone)}` : ""}`}
        suggested={l.preferredAt}
        defaultTitle={`Reunião com ${l.name}`}
        onSubmit={schedule}
      />
    </div>
  );
}

export function LeadSheet({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!leadId} onOpenChange={(v) => !v && onClose()} title="Lead" width={540}>
      {leadId && <Body id={leadId} onClose={onClose} />}
    </Sheet>
  );
}
