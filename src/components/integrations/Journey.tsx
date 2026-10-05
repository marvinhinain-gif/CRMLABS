"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ClipboardList, Footprints, Plus } from "lucide-react";
import { api, fetcher } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { Button, Dialog, Field, Input, LoadingState } from "@/components/ui";
import { SourceChip, useCatalog } from "./shared";

export type Journey = {
  first: { id: string; name: string; color: string; at: string | null } | null;
  last: { id: string; name: string; color: string; at: string | null } | null;
  product: string | null;
  touchpoints: {
    id: string;
    kind: string;
    campaign: string | null;
    channel: string | null;
    partner: string | null;
    adName: string | null;
    integrationName: string | null;
    note: string | null;
    occurredAt: string;
    actorName: string | null;
    source: { id: string; name: string; color: string } | null;
  }[];
  qualified: { key: string; label: string; value: string; at: string; showToCloser: boolean }[];
};

/** "Stories → Quiz Consultoria → 05/10/2026" */
export function OriginTrail({ source, parts, at }: { source: { name: string; color?: string | null } | null; parts: (string | null | undefined)[]; at?: string | null }) {
  const items = [...parts.filter(Boolean), at ? formatDate(at) : null].filter(Boolean) as string[];
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13.5px]">
      {source ? <SourceChip name={source.name} color={source.color} /> : <span className="text-muted">Sem origem</span>}
      {items.map((t, i) => (
        <span key={i} className="inline-flex items-center gap-1.5 text-ink">
          <span className="text-muted" aria-hidden>
            →
          </span>
          {t}
        </span>
      ))}
    </div>
  );
}

function AddTouchpoint({ contactId, open, onOpenChange, onSaved }: { contactId: string; open: boolean; onOpenChange: (v: boolean) => void; onSaved: (j: Journey) => void }) {
  const { data: cat } = useCatalog();
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [campaign, setCampaign] = useState("");
  const [partner, setPartner] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!sourceId) return;
    setBusy(true);
    try {
      onSaved(await api.post<Journey>(`/api/contacts/${contactId}/touchpoints`, { sourceId, campaign: campaign || null, partner: partner || null, note: note || null }));
      toast.success("Origem registrada na jornada.");
      onOpenChange(false);
      setSourceId(null);
      setCampaign("");
      setPartner("");
      setNote("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Registrar origem"
      description="Ex.: a pessoa voltou a falar com vocês depois de ver os Stories. A primeira origem nunca é apagada."
      size="sm"
      footer={
        <Button onClick={save} loading={busy} disabled={!sourceId}>
          Registrar
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Origem">
          {cat?.sources.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={sourceId === s.id} onClick={() => setSourceId(s.id)} className={`rounded-full border-2 ${sourceId === s.id ? "border-brand" : "border-transparent"}`}>
              <SourceChip name={s.name} color={s.color} className="px-3 py-1 text-[13.5px]" />
            </button>
          ))}
        </div>
        <Field label="Campanha (opcional)" htmlFor="tp-camp">
          <Input id="tp-camp" value={campaign} onChange={(e) => setCampaign(e.target.value)} />
        </Field>
        <Field label="Parceiro / collab (opcional)" htmlFor="tp-partner">
          <Input id="tp-partner" value={partner} onChange={(e) => setPartner(e.target.value)} />
        </Field>
        <Field label="Observação (opcional)" htmlFor="tp-note">
          <Input id="tp-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </Field>
      </div>
    </Dialog>
  );
}

/** Origem (primeira/última), dados qualificados e linha do tempo de pontos de contato. */
export function JourneySection({ contactId, initial, compact, closerView }: { contactId: string; initial?: Journey | null; compact?: boolean; closerView?: boolean }) {
  const { data, mutate } = useSWR<Journey | null>(`/api/contacts/${contactId}/journey`, fetcher, { fallbackData: initial ?? undefined });
  const [adding, setAdding] = useState(false);
  if (data === undefined) return <LoadingState rows={2} />;
  if (!data) return null;
  const qualified = closerView ? data.qualified.filter((q) => q.showToCloser) : data.qualified;
  const tps = [...data.touchpoints].reverse();
  return (
    <div className="flex flex-col gap-4">
      {(qualified.length > 0 || data.product) && (
        <div className="rounded-[18px] border border-[#c9ebdc] bg-selected/60 p-4">
          <p className="mb-2 flex items-center gap-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-brand">
            <ClipboardList className="size-4" aria-hidden /> {closerView ? "Para a call" : "Dados da aplicação"}
          </p>
          <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
            {data.product && (
              <div>
                <dt className="text-[12px] text-muted">Produto de interesse</dt>
                <dd className="text-[14.5px] font-semibold">{data.product}</dd>
              </div>
            )}
            {qualified.map((q) => (
              <div key={q.key}>
                <dt className="text-[12px] text-muted">{q.label}</dt>
                <dd className="whitespace-pre-wrap break-words text-[14.5px] font-medium">{q.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[16px] border border-line p-3">
          <p className="text-[12px] text-muted">Primeira origem</p>
          <div className="mt-1">{data.first ? <OriginTrail source={data.first} parts={[]} at={data.first.at} /> : <span className="text-[13.5px] text-muted">Não registrada</span>}</div>
        </div>
        <div className="rounded-[16px] border border-line p-3">
          <p className="text-[12px] text-muted">Última origem</p>
          <div className="mt-1">{data.last ? <OriginTrail source={data.last} parts={[]} at={data.last.at} /> : <span className="text-[13.5px] text-muted">Não registrada</span>}</div>
        </div>
      </div>
      {!compact && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-wide text-muted">
              <Footprints className="size-4" aria-hidden /> Jornada
            </p>
            <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Registrar origem
            </Button>
          </div>
          {tps.length === 0 ? (
            <p className="text-[13.5px] text-muted">Nenhum ponto de contato registrado ainda.</p>
          ) : (
            <ol className="relative flex flex-col gap-3 border-l-2 border-line pl-4">
              {tps.map((t, i) => (
                <li key={t.id} className="anim-fade relative" style={{ "--i": i } as React.CSSProperties}>
                  <span className="absolute -left-[23px] top-1 size-3 rounded-full border-2 border-white" style={{ background: `var(--stage-${t.source?.color ?? "gray"}-dot)` }} aria-hidden />
                  <p className="text-[12px] text-muted">{formatDateTime(t.occurredAt)}</p>
                  <OriginTrail source={t.source} parts={[t.channel, t.partner, t.campaign, t.integrationName]} />
                  {t.note && (
                    <p className="mt-0.5 text-[13px] text-muted">
                      {t.note}
                      {t.actorName ? ` · ${t.actorName}` : ""}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
          <AddTouchpoint contactId={contactId} open={adding} onOpenChange={setAdding} onSaved={(j) => mutate(j, { revalidate: false })} />
        </div>
      )}
    </div>
  );
}
