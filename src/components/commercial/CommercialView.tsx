"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { CalendarPlus, CalendarDays, CircleX, Plus, RotateCcw, Send, Trophy, Handshake, MapPin } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import type { Stage } from "@/lib/types";
import { dayLabel, formatBRL, formatDate, formatDateTime, fromLocalInput, parseBRLToCents } from "@/lib/format";
import { Avatar, Badge, Button, Card, cx, DemoBadge, Dialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { ContactPicker } from "@/components/contacts/ContactPicker";
import { CommercialKanban } from "./CommercialKanban";
import { OpportunitySheet } from "./OpportunitySheet";

type Opp = {
  id: string;
  title: string;
  product: string | null;
  valueCents: number;
  status: "open" | "won" | "lost";
  stageId: string;
  version: number;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  contactId: string;
  contactName: string;
  contactUsername: string | null;
  closerId: string | null;
  closerName: string | null;
  forwardedAt: string | null;
  createdAt: string;
  stageName: string | null;
};
type OppList = { stages: Stage[]; rows: Opp[] };
type Appt = { id: string; title: string; startsAt: string; endsAt: string; location: string | null; status: "scheduled" | "done" | "canceled" | "no_show"; contactId: string; contactName: string; ownerName: string | null; notes: string | null };

const APPT_STATUS: Record<Appt["status"], { label: string; tone: "info" | "success" | "neutral" | "warning" }> = {
  scheduled: { label: "Agendada", tone: "info" },
  done: { label: "Realizada", tone: "success" },
  canceled: { label: "Cancelada", tone: "neutral" },
  no_show: { label: "Não compareceu", tone: "warning" },
};

function NewOpportunityDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const team = useTeam();
  const me = useMe();
  const { mutate } = useSWRConfig();
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ title: "", product: "", value: "", closerId: "", stageId: "", expectedCloseDate: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === "closerId" ? { stageId: "" } : {}) }));
  const stageOwner = form.closerId || (me.user.role === "closer" ? me.user.id : "");
  const { data: stageList } = useSWR<Stage[]>(open ? `/api/stages${qs({ kind: "sales", ownerId: stageOwner })}` : null, fetcher);
  const stages = (stageList ?? []).filter((s) => s.stageType !== "won" && s.stageType !== "lost");
  const submit = async () => {
    const cents = parseBRLToCents(form.value);
    if (cents === null) return setFields({ valueCents: "Valor inválido." });
    if (!contact) return setFields({ contactId: "Escolha o contato." });
    setLoading(true);
    try {
      await api.post("/api/opportunities", { contactId: contact.id, title: form.title, product: form.product || null, valueCents: cents, closerId: form.closerId || null, stageId: form.stageId || null, expectedCloseDate: form.expectedCloseDate || null });
      toast.success("Oportunidade criada.");
      mutate((k) => typeof k === "string" && (k.startsWith("/api/opportunities") || k.startsWith("/api/dashboard") || k.startsWith("/api/commercial")));
      onOpenChange(false);
      setContact(null);
      setForm({ title: "", product: "", value: "", closerId: "", stageId: "", expectedCloseDate: "" });
    } catch (e) {
      setFields((e as ApiError).fields);
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nova oportunidade"
      description="Registro comercial vinculado a um contato. O valor é negociado, não pagamento recebido."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={loading} disabled={!form.title.trim()}>
            Criar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Contato" error={fields.contactId}>
          <ContactPicker value={contact} onChange={setContact} />
        </Field>
        <Field label="Título" htmlFor="op-title" error={fields.title}>
          <Input id="op-title" value={form.title} onChange={set("title")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Produto/serviço" htmlFor="op-prod">
            <Input id="op-prod" value={form.product} onChange={set("product")} />
          </Field>
          <Field label="Valor (R$)" htmlFor="op-val" error={fields.valueCents}>
            <Input id="op-val" inputMode="decimal" value={form.value} onChange={set("value")} placeholder="0,00" />
          </Field>
          <Field label="Closer" htmlFor="op-closer">
            <Select id="op-closer" value={form.closerId} onChange={set("closerId")}>
              <option value="">{me.user.role === "closer" ? "Eu" : "Sem closer"}</option>
              {team
                .filter((m) => m.status === "active" && ["closer", "manager", "admin"].includes(m.role))
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Etapa" htmlFor="op-stage">
            <Select id="op-stage" value={form.stageId} onChange={set("stageId")}>
              <option value="">{stages[0]?.name ?? "Primeira etapa"}</option>
              {stages.slice(1).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Previsão de fechamento" htmlFor="op-date">
            <Input id="op-date" type="date" value={form.expectedCloseDate} onChange={set("expectedCloseDate")} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

function AppointmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { mutate } = useSWRConfig();
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ title: "Reunião", start: "", end: "", location: "", notes: "" });
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    if (!contact) return setFields({ contactId: "Escolha o contato." });
    setLoading(true);
    try {
      await api.post("/api/appointments", { contactId: contact.id, title: form.title, startsAt: fromLocalInput(form.start), endsAt: fromLocalInput(form.end), timezone: "America/Bahia", location: form.location || null, notes: form.notes || null });
      mutate((k) => typeof k === "string" && k.startsWith("/api/commercial"));
      toast.success("Reunião registrada.");
      mutate((k) => typeof k === "string" && (k.startsWith("/api/appointments") || k.startsWith("/api/dashboard")));
      onOpenChange(false);
    } catch (e) {
      setFields((e as ApiError).fields);
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nova reunião"
      description="Entra na agenda do responsável (e no Google Agenda dele, se conectado)."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={loading} disabled={!form.start || !form.end}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Contato" error={fields.contactId}>
          <ContactPicker value={contact} onChange={setContact} />
        </Field>
        <Field label="Título" htmlFor="ap-title">
          <Input id="ap-title" value={form.title} onChange={set("title")} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Início" htmlFor="ap-start" error={fields.startsAt}>
            <Input id="ap-start" type="datetime-local" value={form.start} onChange={set("start")} />
          </Field>
          <Field label="Fim" htmlFor="ap-end" error={fields.endsAt}>
            <Input id="ap-end" type="datetime-local" value={form.end} onChange={set("end")} />
          </Field>
        </div>
        <Field label="Local ou link" htmlFor="ap-loc">
          <Input id="ap-loc" value={form.location} onChange={set("location")} />
        </Field>
        <Field label="Observações" htmlFor="ap-notes">
          <Textarea id="ap-notes" value={form.notes} onChange={set("notes")} />
        </Field>
      </div>
    </Dialog>
  );
}

const STATUS_CHIP = { open: { label: "Em andamento", tone: "info" }, won: { label: "Venda ganha", tone: "success" }, lost: { label: "Perdida", tone: "neutral" } } as const;

export function CommercialView() {
  const me = useMe();
  const isSeller = me.user.role === "seller";
  const [tab, setTab] = useQueryParam("aba", isSeller ? "encaminhados" : "kanban");
  const [op, setOp] = useQueryParam("op", "");
  const [owner, setOwner] = useQueryParam("closer", "");
  const [newOpp, setNewOpp] = useState(false);
  const [newAppt, setNewAppt] = useState(false);
  const status = tab === "ganhas" ? "won" : tab === "perdidas" ? "lost" : tab === "encaminhados" ? "all" : "open";
  const listTab = tab === "ganhas" || tab === "perdidas" || tab === "encaminhados";
  const { data, error, isLoading, mutate } = useSWR<OppList>(listTab ? `/api/opportunities${qs({ status })}` : null, fetcher);
  const { data: appts, error: apptErr, mutate: mutateAppts } = useSWR<Appt[]>(tab === "reunioes" ? `/api/appointments${qs({ from: new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10) })}` : null, fetcher);
  const openContact = useOpenContact();

  const reopen = async (o: Opp) => {
    try {
      await api.post(`/api/opportunities/${o.id}/decide`, { status: "open" });
      toast.success("Oportunidade reaberta. As métricas foram recalculadas.");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const setApptStatus = async (a: Appt, s: Appt["status"]) => {
    try {
      await api.patch(`/api/appointments/${a.id}`, { status: s });
      mutateAppts();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const tabs = [
    ...(isSeller ? [] : [{ value: "kanban", label: "Kanban", icon: <Handshake /> }]),
    { value: "encaminhados", label: isSeller ? "Meus encaminhamentos" : "Encaminhados", icon: <Send /> },
    { value: "reunioes", label: "Reuniões", icon: <CalendarDays /> },
    ...(isSeller ? [] : [{ value: "ganhas", label: "Ganhas", icon: <Trophy /> }, { value: "perdidas", label: "Perdidas", icon: <CircleX /> }]),
  ];
  const forwarded = (data?.rows ?? []).filter((o) => tab !== "encaminhados" || o.forwardedAt || isSeller);

  return (
    <div className="mx-auto flex max-w-[1700px] flex-col gap-5">
      <PageHeader
        title="Comercial"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle={isSeller ? "Leads que você qualificou e encaminhou aos closers." : "Seu Kanban comercial: arraste os leads entre as etapas. Cada movimento fica no histórico."}
        actions={
          isSeller ? undefined : (
            <>
              <Button variant="secondary" icon={<CalendarPlus className="size-4" />} onClick={() => setNewAppt(true)}>
                Nova reunião
              </Button>
              <Button icon={<Plus className="size-4" />} onClick={() => setNewOpp(true)}>
                Novo lead
              </Button>
            </>
          )
        }
      />
      <Tabs value={tab} onChange={setTab} className="self-start max-w-full overflow-x-auto" items={tabs} />

      {tab === "kanban" && !isSeller ? (
        <CommercialKanban onOpen={setOp} ownerParam={owner} setOwnerParam={setOwner} />
      ) : tab === "reunioes" ? (
        apptErr ? (
          <ErrorState error={apptErr} onRetry={() => mutateAppts()} />
        ) : !appts ? (
          <LoadingState />
        ) : appts.length === 0 ? (
          <Card>
            <EmptyState icon={<CalendarDays />} title="Nenhuma reunião registrada" action={!isSeller ? <Button onClick={() => setNewAppt(true)}>Nova reunião</Button> : undefined} />
          </Card>
        ) : (
          <Card className="divide-y divide-line">
            {appts.map((a) => (
              <div key={a.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
                <div className="w-[150px] shrink-0">
                  <p className="text-[14.5px] font-semibold">{dayLabel(a.startsAt)}</p>
                  <p className="text-[12.5px] text-muted">até {formatDateTime(a.endsAt).slice(-5)}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-medium">{a.title}</p>
                  <p className="text-[13px] text-muted">
                    <button className="text-brand hover:underline" onClick={() => openContact(a.contactId)}>
                      {a.contactName}
                    </button>{" "}
                    · {a.ownerName ?? "—"}
                    {a.location && (
                      <>
                        {" "}
                        · <MapPin className="inline size-3" aria-hidden /> {a.location}
                      </>
                    )}
                  </p>
                </div>
                <Badge tone={APPT_STATUS[a.status].tone}>{APPT_STATUS[a.status].label}</Badge>
                <Select aria-label={`Status de ${a.title}`} value={a.status} onChange={(e) => setApptStatus(a, e.target.value as Appt["status"])} className="h-9 w-auto text-[13px]">
                  {Object.entries(APPT_STATUS).map(([v, s]) => (
                    <option key={v} value={v}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>
            ))}
          </Card>
        )
      ) : error ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : isLoading || !data ? (
        <LoadingState />
      ) : tab === "encaminhados" ? (
        forwarded.length === 0 ? (
          <Card>
            <EmptyState icon={<Send />} title="Nenhum lead encaminhado ainda" description={isSeller ? "Quando um lead estiver qualificado, use “Encaminhar para Closer” no Social Seller, em Leads ou no contato." : "Leads encaminhados pelos social sellers aparecem aqui."} />
          </Card>
        ) : (
          <Card className="divide-y divide-line">
            {forwarded.map((o) => (
              <button key={o.id} onClick={() => setOp(o.id)} className="flex w-full flex-col gap-2 p-4 text-left hover:bg-page/60 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={o.contactName} size={40} />
                  <div className="min-w-0">
                    <p className="truncate text-[14.5px] font-semibold">{o.contactName}</p>
                    <p className="text-[12.5px] text-muted">Encaminhado em {formatDateTime(o.forwardedAt ?? o.createdAt)}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <span className="inline-flex items-center gap-1.5 text-[13.5px]">
                    <TeamAvatar userId={o.closerId} name={o.closerName ?? "?"} size={24} /> {o.closerName ? `Closer: ${o.closerName}` : "Sem closer"}
                  </span>
                  {o.status === "open" && o.stageName && <span className="rounded-full bg-page px-2.5 py-0.5 text-[12.5px]">{o.stageName}</span>}
                  <Badge tone={STATUS_CHIP[o.status].tone}>{o.status === "won" ? `${STATUS_CHIP.won.label} · ${formatBRL(o.valueCents, true)}` : STATUS_CHIP[o.status].label}</Badge>
                </div>
              </button>
            ))}
          </Card>
        )
      ) : data.rows.length === 0 ? (
        <Card>
          <EmptyState icon={tab === "ganhas" ? <Trophy /> : <CircleX />} title={tab === "ganhas" ? "Nenhuma venda ganha ainda" : "Nenhuma oportunidade perdida"} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-line bg-page/60 text-[13px] text-muted">
                <th className="px-5 py-3 font-medium">Lead</th>
                <th className="px-3 py-3 font-medium">Closer</th>
                <th className="px-3 py-3 font-medium">{tab === "ganhas" ? "Valor ganho" : "Motivo"}</th>
                <th className="px-3 py-3 font-medium">Fechamento</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3">
                    <button className="text-left hover:underline" onClick={() => setOp(o.id)}>
                      <span className="block text-[14.5px] font-medium">{o.contactName}</span>
                      <span className="block text-[12.5px] text-muted">{o.title}</span>
                    </button>
                  </td>
                  <td className="px-3 py-3 text-[14px]">{o.closerName ?? "—"}</td>
                  <td className={cx("px-3 py-3 text-[14px]", tab === "ganhas" && "font-semibold")}>{tab === "ganhas" ? formatBRL(o.valueCents) : o.lostReason}</td>
                  <td className="px-3 py-3 text-[13.5px] text-muted">{formatDate(o.closedAt)}</td>
                  <td className="px-3 py-3 text-right">
                    {me.permissions.decide && (
                      <Button size="sm" variant="ghost" icon={<RotateCcw className="size-4" />} onClick={() => reopen(o)}>
                        Reabrir
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tab === "ganhas" && <p className="px-5 py-3 text-[12.5px] text-muted border-t border-line">Valores negociados ganhos — não representam pagamentos recebidos.</p>}
        </Card>
      )}

      {!isSeller && <NewOpportunityDialog open={newOpp} onOpenChange={setNewOpp} />}
      <AppointmentDialog open={newAppt} onOpenChange={setNewAppt} />
      <OpportunitySheet id={op || null} onClose={() => setOp("")} />
    </div>
  );
}
