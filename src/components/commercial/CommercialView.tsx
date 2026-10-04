"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { ArrowRightLeft, CalendarPlus, CalendarDays, CircleX, Ellipsis, Plus, RotateCcw, Trophy, Handshake, MapPin } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import type { Stage } from "@/lib/types";
import { dayLabel, formatBRL, formatDate, formatDateTime, fromLocalInput, parseBRLToCents } from "@/lib/format";
import { Avatar, Badge, Button, Card, cx, DemoBadge, Dialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, PageHeader, Select, Tabs, Textarea } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";

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
};
type OppList = { stages: Stage[]; rows: Opp[] };
type Appt = { id: string; title: string; startsAt: string; endsAt: string; location: string | null; status: "scheduled" | "done" | "canceled" | "no_show"; contactId: string; contactName: string; ownerName: string | null; notes: string | null };

const APPT_STATUS: Record<Appt["status"], { label: string; tone: "info" | "success" | "neutral" | "warning" }> = {
  scheduled: { label: "Agendada", tone: "info" },
  done: { label: "Realizada", tone: "success" },
  canceled: { label: "Cancelada", tone: "neutral" },
  no_show: { label: "Não compareceu", tone: "warning" },
};

function ContactPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const { data } = useSWR<{ rows: { id: string; name: string; username: string | null }[] }>(q.length >= 2 && !value ? `/api/contacts${qs({ q, pageSize: 6 })}` : null, fetcher);
  if (value)
    return (
      <div className="flex items-center gap-3 rounded-[14px] border border-brand bg-selected/50 px-3 py-2">
        <Avatar name={value.name} size={30} />
        <span className="flex-1 text-[14px] font-medium">{value.name}</span>
        <Button size="sm" variant="ghost" onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );
  return (
    <div>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contato por nome ou @" aria-label="Buscar contato" />
      {data?.rows.map((r) => (
        <button key={r.id} type="button" onClick={() => onChange({ id: r.id, name: r.name })} className="mt-1 flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[14px] hover:bg-page">
          <Avatar name={r.name} size={26} /> {r.name} <span className="text-[12.5px] text-muted">{r.username ? `@${r.username}` : ""}</span>
        </button>
      ))}
    </div>
  );
}

function NewOpportunityDialog({ open, onOpenChange, stages }: { open: boolean; onOpenChange: (v: boolean) => void; stages: Stage[] }) {
  const team = useTeam();
  const me = useMe();
  const { mutate } = useSWRConfig();
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({ title: "", product: "", value: "", closerId: "", stageId: "", expectedCloseDate: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    const cents = parseBRLToCents(form.value);
    if (cents === null) return setFields({ valueCents: "Valor inválido." });
    if (!contact) return setFields({ contactId: "Escolha o contato." });
    setLoading(true);
    try {
      await api.post("/api/opportunities", { contactId: contact.id, title: form.title, product: form.product || null, valueCents: cents, closerId: form.closerId || null, stageId: form.stageId || null, expectedCloseDate: form.expectedCloseDate || null });
      toast.success("Oportunidade criada.");
      mutate((k) => typeof k === "string" && (k.startsWith("/api/opportunities") || k.startsWith("/api/dashboard")));
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

function DecideDialog({ opp, mode, onClose }: { opp: Opp | null; mode: "won" | "lost" | null; onClose: () => void }) {
  const { mutate } = useSWRConfig();
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  if (!opp || !mode) return null;
  const submit = async () => {
    setLoading(true);
    try {
      if (mode === "won") {
        const cents = value ? parseBRLToCents(value) : opp.valueCents;
        if (cents === null) throw new Error("Valor inválido.");
        await api.post(`/api/opportunities/${opp.id}/decide`, { status: "won", valueCents: cents });
        toast.success("Venda registrada como ganha.");
      } else {
        await api.post(`/api/opportunities/${opp.id}/decide`, { status: "lost", lostReason: reason });
        toast.success("Oportunidade marcada como perdida.");
      }
      mutate((k) => typeof k === "string" && (k.startsWith("/api/opportunities") || k.startsWith("/api/dashboard")));
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      size="sm"
      title={mode === "won" ? "Registrar venda ganha" : "Registrar perda"}
      description={opp.title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={mode === "won" ? "primary" : "danger"} onClick={submit} loading={loading} disabled={mode === "lost" && reason.trim().length < 3}>
            Confirmar
          </Button>
        </>
      }
    >
      {mode === "won" ? (
        <Field label="Valor negociado (R$)" htmlFor="dc-val" hint={`Atual: ${formatBRL(opp.valueCents)}. Representa o valor ganho, não o recebimento financeiro.`}>
          <Input id="dc-val" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={(opp.valueCents / 100).toFixed(2).replace(".", ",")} />
        </Field>
      ) : (
        <Field label="Motivo da perda" htmlFor="dc-reason">
          <Textarea id="dc-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: Sem orçamento no momento" />
        </Field>
      )}
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
      description="Registro interno (fuso America/Bahia). Integração com agenda externa é uma evolução futura."
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

function OppCard({ o, stages, onDecide }: { o: Opp; stages: Stage[]; onDecide: (o: Opp, m: "won" | "lost") => void }) {
  const me = useMe();
  const openContact = useOpenContact();
  const { mutate } = useSWRConfig();
  const move = async (stageId: string) => {
    try {
      await api.patch(`/api/opportunities/${o.id}`, { stageId, expectedVersion: o.version });
      mutate((k) => typeof k === "string" && k.startsWith("/api/opportunities"));
    } catch (e) {
      toast.error((e as Error).message);
      mutate((k) => typeof k === "string" && k.startsWith("/api/opportunities"));
    }
  };
  return (
    <article className="rounded-[18px] bg-white p-4 shadow-[0_1px_2px_rgb(16_60_48/0.05)] border border-transparent hover:border-brand">
      <div className="flex items-start gap-2">
        <button className="min-w-0 flex-1 text-left" onClick={() => openContact(o.contactId)}>
          <p className="truncate text-[14.5px] font-semibold">{o.title}</p>
          <p className="truncate text-[12.5px] text-muted">{o.contactName}</p>
        </button>
        {me.permissions.decide && (
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={`Ações para ${o.title}`} size="sm">
                <Ellipsis className="size-5" />
              </IconButton>
            </MenuTrigger>
            <MenuContent>
              <MenuSub>
                <MenuSubTrigger icon={<ArrowRightLeft />}>Mover para etapa</MenuSubTrigger>
                <MenuSubContent>
                  <MenuLabel>Mover para</MenuLabel>
                  {stages.map((s) => (
                    <MenuItem key={s.id} disabled={s.id === o.stageId} onSelect={() => move(s.id)}>
                      {s.name}
                    </MenuItem>
                  ))}
                </MenuSubContent>
              </MenuSub>
              <MenuSeparator />
              <MenuItem icon={<Trophy />} onSelect={() => onDecide(o, "won")}>
                Marcar como ganha
              </MenuItem>
              <MenuItem icon={<CircleX />} danger onSelect={() => onDecide(o, "lost")}>
                Marcar como perdida
              </MenuItem>
            </MenuContent>
          </Menu>
        )}
      </div>
      <p className="mt-3 text-[17px] font-bold">{formatBRL(o.valueCents)}</p>
      <div className="mt-2 flex items-center justify-between text-[12.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <TeamAvatar userId={o.closerId} name={o.closerName ?? "?"} size={24} /> {o.closerName ?? "Sem closer"}
        </span>
        {o.expectedCloseDate && <span>Prev. {formatDate(`${o.expectedCloseDate}T12:00:00-03:00`)}</span>}
      </div>
    </article>
  );
}

export function CommercialView() {
  const me = useMe();
  const [tab, setTab] = useQueryParam("aba", "funil");
  const [newOpp, setNewOpp] = useState(false);
  const [newAppt, setNewAppt] = useState(false);
  const [decide, setDecide] = useState<{ o: Opp; m: "won" | "lost" } | null>(null);
  const status = tab === "ganhas" ? "won" : tab === "perdidas" ? "lost" : "open";
  const { data, error, isLoading, mutate } = useSWR<OppList>(tab !== "reunioes" ? `/api/opportunities${qs({ status })}` : null, fetcher);
  const { data: appts, error: apptErr, mutate: mutateAppts } = useSWR<Appt[]>(tab === "reunioes" ? `/api/appointments${qs({ from: new Date(Date.now() - 30 * 86400000).toISOString() })}` : null, fetcher);
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

  const total = data?.rows.reduce((acc, o) => acc + o.valueCents, 0) ?? 0;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <PageHeader
        title="Comercial"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle="Oportunidades, reuniões e resultados da equipe."
        actions={
          <>
            <Button variant="secondary" icon={<CalendarPlus className="size-4" />} onClick={() => setNewAppt(true)}>
              Nova reunião
            </Button>
            <Button icon={<Plus className="size-4" />} onClick={() => setNewOpp(true)}>
              Nova oportunidade
            </Button>
          </>
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="self-start"
        items={[
          { value: "funil", label: "Funil", icon: <Handshake /> },
          { value: "reunioes", label: "Reuniões", icon: <CalendarDays /> },
          { value: "ganhas", label: "Ganhas", icon: <Trophy /> },
          { value: "perdidas", label: "Perdidas", icon: <CircleX /> },
        ]}
      />

      {tab === "reunioes" ? (
        apptErr ? (
          <ErrorState error={apptErr} onRetry={() => mutateAppts()} />
        ) : !appts ? (
          <LoadingState />
        ) : appts.length === 0 ? (
          <Card>
            <EmptyState icon={<CalendarDays />} title="Nenhuma reunião registrada" action={<Button onClick={() => setNewAppt(true)}>Nova reunião</Button>} />
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
      ) : tab === "funil" ? (
        <>
          <p className="text-[13.5px] text-muted">
            {data.rows.length} oportunidade(s) abertas · {formatBRL(total)} em negociação
          </p>
          <div className="-mx-4 sm:mx-0 overflow-x-auto scroll-thin pb-3">
            <div className="flex gap-4 px-4 sm:px-0 items-start">
              {data.stages.map((s) => {
                const items = data.rows.filter((o) => o.stageId === s.id);
                return (
                  <section key={s.id} aria-label={`Etapa ${s.name}`} className="w-[86vw] max-w-[300px] sm:w-[290px] shrink-0 rounded-[22px] p-3" style={{ background: `var(--stage-${s.color}-bg)` }}>
                    <header className="flex items-center gap-2 px-2 pb-3 pt-1">
                      <span className="size-3 rounded-full" style={{ background: `var(--stage-${s.color}-dot)` }} aria-hidden />
                      <h3 className="text-[15px] font-semibold">{s.name}</h3>
                      <span className="rounded-full px-2 text-[12.5px] font-semibold" style={{ background: `var(--stage-${s.color}-chip)` }}>
                        {items.length}
                      </span>
                      <span className="ml-auto text-[12.5px] font-medium text-muted">{formatBRL(items.reduce((a, o) => a + o.valueCents, 0), true)}</span>
                    </header>
                    <div className="flex flex-col gap-3">
                      {items.map((o) => (
                        <OppCard key={o.id} o={o} stages={data.stages} onDecide={(op, m) => setDecide({ o: op, m })} />
                      ))}
                      {!items.length && <p className="py-6 text-center text-[13px] text-muted">Vazio</p>}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </>
      ) : data.rows.length === 0 ? (
        <Card>
          <EmptyState icon={tab === "ganhas" ? <Trophy /> : <CircleX />} title={tab === "ganhas" ? "Nenhuma venda ganha ainda" : "Nenhuma oportunidade perdida"} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left">
            <thead>
              <tr className="border-b border-line bg-page/60 text-[13px] text-muted">
                <th className="px-5 py-3 font-medium">Oportunidade</th>
                <th className="px-3 py-3 font-medium">Contato</th>
                <th className="px-3 py-3 font-medium">Closer</th>
                <th className="px-3 py-3 font-medium">{tab === "ganhas" ? "Valor ganho" : "Motivo"}</th>
                <th className="px-3 py-3 font-medium">Fechamento</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 text-[14.5px] font-medium">{o.title}</td>
                  <td className="px-3 py-3">
                    <button className="text-[14px] text-brand hover:underline" onClick={() => openContact(o.contactId)}>
                      {o.contactName}
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

      <NewOpportunityDialog open={newOpp} onOpenChange={setNewOpp} stages={data?.stages ?? []} />
      <AppointmentDialog open={newAppt} onOpenChange={setNewAppt} />
      <DecideDialog opp={decide?.o ?? null} mode={decide?.m ?? null} onClose={() => setDecide(null)} />
    </div>
  );
}
