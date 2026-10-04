"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { AtSign } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import type { Stage } from "@/lib/types";
import { fromLocalInput } from "@/lib/format";
import { Button, Dialog, Field, Input, Select } from "@/components/ui";

type Dup = { id: string; name: string; username: string | null; email: string | null };

export function NewContactDialog({ open, onOpenChange, defaultStageId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; defaultStageId?: string | null; onCreated?: (id: string) => void }) {
  const me = useMe();
  const team = useTeam();
  const { data: stages } = useSWR<Stage[]>(open ? "/api/stages?kind=relationship" : null, fetcher);
  const { mutate } = useSWRConfig();
  const empty = { name: "", username: "", stageId: "", ownerId: "", summary: "", nextAction: "", nextActionAt: "", email: "", phone: "" };
  const [form, setForm] = useState(empty);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [dups, setDups] = useState<{ list: Dup[]; hidden: number } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ ...empty, stageId: defaultStageId ?? "", ownerId: me.permissions.assign ? "" : me.user.id });
      setFields({});
      setDups(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultStageId]);

  useEffect(() => {
    if (open && stages?.length && !form.stageId && defaultStageId === undefined) setForm((f) => ({ ...f, stageId: stages[0].id }));
  }, [open, stages, form.stageId, defaultStageId]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (force = false) => {
    setLoading(true);
    setFields({});
    try {
      const created = await api.post<{ id: string }>("/api/contacts", {
        name: form.name,
        username: form.username || null,
        stageId: form.stageId || null,
        ownerId: me.permissions.assign ? form.ownerId || null : undefined,
        summary: form.summary || null,
        nextAction: form.nextAction || null,
        nextActionAt: fromLocalInput(form.nextActionAt),
        email: form.email || null,
        phone: form.phone || null,
        force,
      });
      toast.success("Contato criado.");
      mutate((k) => typeof k === "string" && (k.startsWith("/api/board") || k.startsWith("/api/contacts") || k.startsWith("/api/dashboard")));
      onOpenChange(false);
      onCreated?.(created.id);
    } catch (e) {
      const err = e as ApiError;
      if (err.code === "conflict" && err.details?.duplicates) {
        setDups({ list: err.details.duplicates as Dup[], hidden: Number(err.details.hiddenDuplicates ?? 0) });
      } else {
        setFields(err.fields);
        toast.error(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Novo contato"
      description="Cadastro manual. O @ informado aqui não é identidade oficial do Instagram e não habilita envio de Direct."
      footer={
        dups ? (
          <>
            <Button variant="secondary" onClick={() => setDups(null)}>
              Revisar
            </Button>
            <Button onClick={() => submit(true)} loading={loading}>
              Criar mesmo assim
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={() => submit(false)} loading={loading} disabled={!form.name.trim()}>
              Criar contato
            </Button>
          </>
        )
      }
    >
      {dups ? (
        <div className="flex flex-col gap-3" role="alert">
          <p className="text-[14px]">Encontramos contato(s) com o mesmo @, e-mail ou telefone:</p>
          {dups.list.map((d) => (
            <div key={d.id} className="rounded-[14px] border border-line px-4 py-3 text-[14px]">
              <p className="font-medium">{d.name}</p>
              <p className="text-muted text-[13px]">{[d.username && `@${d.username}`, d.email].filter(Boolean).join(" · ")}</p>
            </div>
          ))}
          {dups.hidden > 0 && <p className="text-[13px] text-muted">E {dups.hidden} registro(s) de outro responsável.</p>}
          <p className="text-[13px] text-muted">Se for a mesma pessoa, use o contato existente. Mesclagens são feitas por gestores em Contatos.</p>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit(false);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome" htmlFor="nc-name" error={fields.name}>
              <Input id="nc-name" value={form.name} onChange={set("name")} autoFocus required />
            </Field>
            <Field label="@ do Instagram" htmlFor="nc-user" error={fields.username}>
              <Input id="nc-user" value={form.username} onChange={set("username")} icon={<AtSign />} placeholder="usuario" />
            </Field>
            <Field label="Etapa" htmlFor="nc-stage">
              <Select id="nc-stage" value={form.stageId} onChange={set("stageId")}>
                <option value="">Não adicionar ao quadro</option>
                {stages?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Responsável" htmlFor="nc-owner">
              <Select id="nc-owner" value={form.ownerId} onChange={set("ownerId")} disabled={!me.permissions.assign}>
                {me.permissions.assign && <option value="">Sem responsável</option>}
                {team
                  .filter((m) => m.status === "active")
                  .map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.name}
                    </option>
                  ))}
              </Select>
            </Field>
          </div>
          <Field label="Resumo curto" htmlFor="nc-sum" hint="Aparece no cartão do Kanban.">
            <Input id="nc-sum" value={form.summary} onChange={set("summary")} maxLength={140} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Próxima ação" htmlFor="nc-na">
              <Input id="nc-na" value={form.nextAction} onChange={set("nextAction")} maxLength={140} />
            </Field>
            <Field label="Quando" htmlFor="nc-nad">
              <Input id="nc-nad" type="datetime-local" value={form.nextActionAt} onChange={set("nextActionAt")} />
            </Field>
            <Field label="E-mail (opcional)" htmlFor="nc-email" error={fields.email}>
              <Input id="nc-email" type="email" value={form.email} onChange={set("email")} />
            </Field>
            <Field label="Telefone (opcional)" htmlFor="nc-phone">
              <Input id="nc-phone" value={form.phone} onChange={set("phone")} />
            </Field>
          </div>
          <button type="submit" className="hidden" />
        </form>
      )}
    </Dialog>
  );
}
