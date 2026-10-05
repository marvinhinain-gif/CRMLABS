"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Archive, ArrowDown, ArrowUp, Plus } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import type { Stage } from "@/lib/types";
import { Button, cx, Dialog, Field, IconButton, Input, Select } from "@/components/ui";
import { STAGE_TYPE_OPTIONS } from "@/lib/stageTypes";

export const STAGE_COLORS: { value: string; label: string }[] = [
  { value: "green", label: "Verde" },
  { value: "blue", label: "Azul" },
  { value: "yellow", label: "Amarelo" },
  { value: "lilac", label: "Lilás" },
  { value: "pink", label: "Rosa" },
  { value: "orange", label: "Laranja" },
  { value: "teal", label: "Turquesa" },
  { value: "gray", label: "Cinza" },
];

function ColorPicker({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {STAGE_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          role="radio"
          aria-checked={value === c.value}
          aria-label={c.label}
          title={c.label}
          onClick={() => onChange(c.value)}
          className={cx("size-7 rounded-full border-2 transition-transform", value === c.value ? "border-ink scale-110" : "border-white")}
          style={{ background: `var(--stage-${c.value}-dot)` }}
        />
      ))}
    </div>
  );
}

/** Editor da estrutura do funil (apenas administrador e gestor). */
export function StagesEditor({ kind, ownerId }: { kind: "relationship" | "sales"; ownerId?: string | null }) {
  const key = `/api/stages?kind=${kind}${ownerId ? `&ownerId=${ownerId}` : ""}`;
  const typed = kind === "sales";
  const [newType, setNewType] = useState("custom");
  const { data: stages, mutate } = useSWR<Stage[]>(key, fetcher);
  const { mutate: gm } = useSWRConfig();
  const [drafts, setDrafts] = useState<Record<string, { name: string; color: string }>>({});
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("green");
  const [archiving, setArchiving] = useState<{ stage: Stage; occupied: number; dest: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (stages) setDrafts(Object.fromEntries(stages.map((s) => [s.id, { name: s.name, color: s.color }])));
  }, [stages]);

  const refresh = () => {
    mutate();
    gm((k) => typeof k === "string" && (k.startsWith("/api/board") || k.startsWith("/api/dashboard") || k.startsWith("/api/opportunities") || k.startsWith("/api/commercial")));
  };

  const saveRow = async (s: Stage) => {
    const d = drafts[s.id];
    if (!d || (d.name === s.name && d.color === s.color)) return;
    if (!d.name.trim()) return toast.error("O nome da etapa não pode ficar vazio.");
    try {
      await api.patch(`/api/stages/${s.id}`, { name: d.name.trim(), color: d.color });
      toast.success("Etapa atualizada.");
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const reorder = async (index: number, dir: -1 | 1) => {
    if (!stages) return;
    const ids = stages.map((s) => s.id);
    const j = index + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j], ids[index]];
    mutate(
      ids.map((id, i) => ({ ...stages.find((s) => s.id === id)!, position: i })),
      { revalidate: false },
    );
    try {
      await api.post("/api/stages/reorder", { kind, orderedIds: ids, ownerId: ownerId ?? null });
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      mutate();
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await api.post("/api/stages", { kind, name: newName.trim(), color: newColor, ...(typed ? { stageType: newType, ownerId: ownerId ?? null } : {}) });
      setNewName("");
      toast.success("Etapa criada.");
      refresh();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const archive = async (stage: Stage, dest?: string) => {
    setBusy(true);
    try {
      const r = await api.post<{ moved: number }>(`/api/stages/${stage.id}/archive`, { destinationStageId: dest ?? null });
      toast.success(r.moved ? `Etapa arquivada. ${r.moved} cartão(ões) movido(s).` : "Etapa arquivada.");
      setArchiving(null);
      refresh();
    } catch (e) {
      const err = e as ApiError;
      if (err.details?.occupied) {
        const other = stages?.find((s) => s.id !== stage.id);
        setArchiving({ stage, occupied: Number(err.details.occupied), dest: other?.id ?? "" });
      } else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!stages) return <div className="skeleton h-40" />;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {stages.map((s, i) => (
          <li key={s.id} className="flex flex-col gap-3 rounded-[16px] border border-line p-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-1">
              <IconButton label={`Mover ${s.name} para cima`} size="sm" disabled={i === 0} onClick={() => reorder(i, -1)}>
                <ArrowUp className="size-4" />
              </IconButton>
              <IconButton label={`Mover ${s.name} para baixo`} size="sm" disabled={i === stages.length - 1} onClick={() => reorder(i, 1)}>
                <ArrowDown className="size-4" />
              </IconButton>
            </div>
            <Input
              aria-label={`Nome da etapa ${i + 1}`}
              value={drafts[s.id]?.name ?? s.name}
              onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: { ...d[s.id], name: e.target.value } }))}
              onBlur={() => saveRow(s)}
              onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
              maxLength={60}
              className="sm:min-w-[200px]"
            />
            {typed && (
              <Select
                aria-label={`Tipo da etapa ${s.name}`}
                title="O tipo diz ao CRM o que a etapa significa (para as métricas)"
                value={s.stageType ?? "custom"}
                onChange={(e) => {
                  const stageType = e.target.value;
                  mutate(stages.map((x) => (x.id === s.id ? { ...x, stageType } : x)), { revalidate: false });
                  api
                    .patch(`/api/stages/${s.id}`, { stageType })
                    .then(refresh)
                    .catch((err) => {
                      toast.error((err as Error).message);
                      mutate();
                    });
                }}
                className="sm:w-[210px] shrink-0"
              >
                {STAGE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
            <ColorPicker
              label={`Cor da etapa ${s.name}`}
              value={drafts[s.id]?.color ?? s.color}
              onChange={(color) => {
                setDrafts((d) => ({ ...d, [s.id]: { ...d[s.id], color } }));
                api
                  .patch(`/api/stages/${s.id}`, { color })
                  .then(refresh)
                  .catch((e) => toast.error((e as Error).message));
              }}
            />
            <IconButton label={`Arquivar etapa ${s.name}`} size="sm" onClick={() => archive(s)} disabled={busy || stages.length <= 1}>
              <Archive className="size-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      {archiving && (
        <div role="alert" className="rounded-[16px] border border-[#f1d9a6] bg-warning-soft p-4 flex flex-col gap-3">
          <p className="text-[14px]">
            <strong>{archiving.stage.name}</strong> tem {archiving.occupied} cartão(ões). Escolha para onde eles vão. Nenhum contato será apagado.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select aria-label="Etapa de destino" value={archiving.dest} onChange={(e) => setArchiving({ ...archiving, dest: e.target.value })}>
              {stages
                .filter((s) => s.id !== archiving.stage.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
            <Button variant="danger" loading={busy} onClick={() => archive(archiving.stage, archiving.dest)}>
              Mover e arquivar
            </Button>
            <Button variant="secondary" onClick={() => setArchiving(null)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
      <form onSubmit={add} className="flex flex-col gap-3 rounded-[16px] border border-dashed border-[#bfd6cf] p-3 sm:flex-row sm:items-end">
        <Field label="Nova etapa" htmlFor={`new-stage-${kind}`} className="flex-1">
          <Input id={`new-stage-${kind}`} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nome da etapa" maxLength={60} />
        </Field>
        {typed && (
          <Field label="Tipo" htmlFor="new-stage-type" className="sm:w-[210px]">
            <Select id="new-stage-type" value={newType} onChange={(e) => setNewType(e.target.value)}>
              {STAGE_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <ColorPicker label="Cor da nova etapa" value={newColor} onChange={setNewColor} />
        <Button type="submit" icon={<Plus className="size-4" />} loading={busy} disabled={!newName.trim()}>
          Adicionar
        </Button>
      </form>
      <p className="text-[12.5px] text-muted">
        {typed
          ? "Dê às colunas o nome que quiser. O tipo diz ao CRM o que cada uma significa (ex.: “Call marcada” do tipo Reunião agendada), para o Dashboard continuar certo."
          : "Renomear não altera o histórico nem os indicadores: cada etapa tem um identificador estável."}
      </p>
    </div>
  );
}

export function EditStagesDialog({ open, onOpenChange, kind = "relationship", ownerId }: { open: boolean; onOpenChange: (v: boolean) => void; kind?: "relationship" | "sales"; ownerId?: string | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={kind === "sales" ? "Etapas do Comercial" : "Editar etapas"} description="Crie, renomeie, colora e reordene. Excluir uma etapa ocupada exige escolher o destino dos cartões." size="lg" footer={<Button onClick={() => onOpenChange(false)}>Concluir</Button>}>
      <StagesEditor kind={kind} ownerId={ownerId} />
    </Dialog>
  );
}
