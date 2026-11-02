"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { CADENCE_CHANNELS, CHANNEL_LABEL, type CadenceChannel } from "@/lib/cadence";
import type { CadenceStep } from "@/lib/types";
import { Button, Dialog, ErrorState, Field, IconButton, Input, LoadingState, Select, Textarea } from "@/components/ui";
import { ChannelGlyph, useRefreshCadence } from "./cadenceUi";

type Draft = { k: string; id?: string; name: string; channel: CadenceChannel; waitDays: number; script: string };

let seq = 0;
const newKey = () => `n${++seq}`;
const MAX_STEPS = 20;

/** Editor dos passos da cadência da organização (requer permissão de editar o funil). */
export function EditCadenceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { data, error, mutate } = useSWR<{ steps: CadenceStep[] }>(open ? "/api/cadence/steps" : null, fetcher);
  const refresh = useRefreshCadence();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Monta o rascunho quando o diálogo abre (revalidações não apagam o que está sendo editado).
  useEffect(() => {
    if (open && data) setDrafts((cur) => cur ?? data.steps.map((s) => ({ k: s.id, id: s.id, name: s.name, channel: s.channel, waitDays: s.waitDays, script: s.script })));
    if (!open) {
      setDrafts(null);
      setFormError(null);
    }
  }, [open, data]);

  const update = (k: string, patch: Partial<Draft>) => setDrafts((d) => d?.map((x) => (x.k === k ? { ...x, ...patch } : x)) ?? d);
  const move = (i: number, dir: -1 | 1) =>
    setDrafts((d) => {
      if (!d) return d;
      const j = i + dir;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const remove = (k: string) => setDrafts((d) => d?.filter((x) => x.k !== k) ?? d);
  const add = () => setDrafts((d) => [...(d ?? []), { k: newKey(), name: "", channel: "whatsapp", waitDays: 1, script: "O que fazer: \nO que mandar: \"Oi {nome}, aqui é {responsavel}…\"" }]);

  const save = async () => {
    if (!drafts) return;
    setFormError(null);
    if (!drafts.length) return setFormError("A cadência precisa ter ao menos um passo.");
    const empty = drafts.findIndex((d) => !d.name.trim());
    if (empty >= 0) return setFormError(`Dê um nome ao passo ${empty + 1}.`);
    setSaving(true);
    try {
      const r = await api.put<{ steps: CadenceStep[] }>("/api/cadence/steps", {
        steps: drafts.map((d) => ({ ...(d.id ? { id: d.id } : {}), name: d.name.trim(), channel: d.channel, waitDays: Math.max(0, Math.min(60, Math.round(d.waitDays) || 0)), script: d.script })),
      });
      mutate(r, { revalidate: false });
      refresh();
      toast.success("Cadência salva.");
      onOpenChange(false);
    } catch (e) {
      const err = e as ApiError;
      setFormError(err.message);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="Editar cadência"
      description="Passos que todo lead em cadência segue, na ordem. Quem já está num passo removido continua dele para o próximo."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save} loading={saving} disabled={!drafts}>
            Salvar cadência
          </Button>
        </>
      }
    >
      {error && !data ? (
        <ErrorState error={error} onRetry={() => mutate()} />
      ) : !drafts ? (
        <LoadingState rows={4} />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="rounded-[14px] bg-page px-3.5 py-2.5 text-[13px] text-muted">
            No roteiro, use <code className="rounded bg-white px-1 font-semibold text-ink">{"{nome}"}</code> para o primeiro nome do lead e <code className="rounded bg-white px-1 font-semibold text-ink">{"{responsavel}"}</code> para o nome de quem está atendendo. No WhatsApp, o texto entre aspas depois de “O que mandar:” já vai pronto na mensagem.
          </p>
          {drafts.length === 0 && <p className="py-6 text-center text-[13.5px] text-muted">Nenhum passo. Adicione o primeiro.</p>}
          <ol className="flex flex-col gap-3">
            {drafts.map((d, i) => (
              <li key={d.k} className="rounded-[18px] border border-line p-3.5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-selected text-[13px] font-semibold text-brand">{i + 1}</span>
                  <ChannelGlyph channel={d.channel} className="size-4 text-muted" />
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{d.name || "Novo passo"}</span>
                  <IconButton size="sm" label={`Subir passo ${i + 1}`} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </IconButton>
                  <IconButton size="sm" label={`Descer passo ${i + 1}`} disabled={i === drafts.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </IconButton>
                  <IconButton size="sm" label={`Remover passo ${i + 1}`} className="hover:text-danger" disabled={drafts.length <= 1} onClick={() => remove(d.k)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_160px_150px]">
                  <Field label="Nome" htmlFor={`cs-name-${d.k}`}>
                    <Input id={`cs-name-${d.k}`} value={d.name} maxLength={80} onChange={(e) => update(d.k, { name: e.target.value })} placeholder="Ex.: Ligação 1" />
                  </Field>
                  <Field label="Canal" htmlFor={`cs-ch-${d.k}`}>
                    <Select id={`cs-ch-${d.k}`} value={d.channel} onChange={(e) => update(d.k, { channel: e.target.value as CadenceChannel })}>
                      {CADENCE_CHANNELS.map((c) => (
                        <option key={c} value={c}>
                          {CHANNEL_LABEL[c]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={i === 0 ? "Dias (ao iniciar)" : "Dias depois da etapa anterior"} htmlFor={`cs-wait-${d.k}`}>
                    <Input id={`cs-wait-${d.k}`} type="number" inputMode="numeric" min={0} max={60} value={String(d.waitDays)} onChange={(e) => update(d.k, { waitDays: Number(e.target.value) || 0 })} />
                  </Field>
                </div>
                <Field label="Roteiro (o que fazer e o que falar/mandar)" htmlFor={`cs-sc-${d.k}`} className="mt-3">
                  <Textarea id={`cs-sc-${d.k}`} value={d.script} maxLength={4000} onChange={(e) => update(d.k, { script: e.target.value })} className="min-h-[96px] text-[14px]" />
                </Field>
              </li>
            ))}
          </ol>
          <Button variant="soft" icon={<Plus className="size-4" />} onClick={add} disabled={drafts.length >= MAX_STEPS} className="self-start max-sm:w-full">
            Adicionar passo
          </Button>
          {formError && (
            <p role="alert" className="text-[13px] text-danger">
              {formError}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
