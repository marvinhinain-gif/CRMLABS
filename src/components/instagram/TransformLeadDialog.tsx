"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { KanbanSquare, UserRoundCheck } from "lucide-react";
import { api, ApiError, fetcher } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact } from "@/lib/nav";
import { Avatar, Button, Dialog, Field, Select, Textarea } from "@/components/ui";
import { ChannelBadge } from "@/components/ui/ChannelIcon";

type Options = { stages: { id: string; name: string; color: string }[]; products: { id: string; name: string }[]; defaultStageId: string | null; canAssignOthers: boolean };

/** Atualiza tudo que mostra se a pessoa é Lead (Direct, comentários, Kanban, contato). */
export function useRefreshLeadViews() {
  const { mutate } = useSWRConfig();
  return () =>
    mutate((k) => typeof k === "string" && (k.startsWith("/api/contacts") || k.startsWith("/api/board") || k.startsWith("/api/conversations") || k.startsWith("/api/instagram") || k.startsWith("/api/leads") || k === "/api/me"));
}

/**
 * "Transformar em Lead": a pessoa só entra no Kanban do Social Seller depois desta confirmação.
 * Contato do Instagram (relacionamento) ≠ Lead comercial (oportunidade).
 */
export function TransformLeadDialog({
  open,
  onOpenChange,
  contact,
  from = "direct",
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact: { id: string; name: string; username: string | null; avatarUrl?: string | null };
  from?: "direct" | "comment";
  onDone?: (summary: unknown) => void;
}) {
  const me = useMe();
  const team = useTeam();
  const openContact = useOpenContact();
  const refresh = useRefreshLeadViews();
  const { data: opts } = useSWR<Options>(open ? "/api/leads/transform-options" : null, fetcher);
  const [stageId, setStageId] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [productId, setProductId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [already, setAlready] = useState<{ message: string; contactId: string } | null>(null);

  useEffect(() => {
    if (open) {
      setOwnerId(me.user.id);
      setProductId("");
      setNote("");
      setAlready(null);
    }
  }, [open, me.user.id]);
  useEffect(() => {
    if (open && opts && !stageId) setStageId(opts.defaultStageId ?? "");
  }, [open, opts, stageId]);

  const owners = team.filter((m) => m.status === "active" && m.role !== "closer" && (opts?.canAssignOthers || m.userId === me.user.id));
  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/contacts/${contact.id}/lead`, { from, stageId, ownerId: ownerId || null, productId: productId || null, note: note.trim() || undefined });
      const stage = opts?.stages.find((s) => s.id === stageId)?.name;
      toast.success(`${contact.username ? `@${contact.username}` : contact.name} agora é Lead${stage ? ` · ${stage}` : ""}.`);
      refresh();
      onDone?.(r);
      onOpenChange(false);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 409 && err.details?.leadContactId) {
        setAlready({ message: err.message, contactId: String(err.details.leadContactId) });
        refresh();
      } else toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title="Transformar em Lead"
      description="A pessoa entra no Kanban do Social Seller só depois desta confirmação."
      footer={
        already ? (
          <Button
            icon={<UserRoundCheck className="size-4" />}
            onClick={() => {
              onOpenChange(false);
              openContact(already.contactId);
            }}
          >
            Ver Lead
          </Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button icon={<KanbanSquare className="size-4" />} onClick={submit} loading={busy} disabled={!stageId}>
              Adicionar ao Kanban
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[12.5px] font-medium text-muted">Contato</p>
          <div className="mt-1 flex items-center gap-2.5">
            <span className="relative shrink-0">
              <Avatar name={contact.name} src={contact.avatarUrl} size={38} />
              <ChannelBadge />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[15.5px] font-semibold">{contact.username ? `@${contact.username}` : contact.name}</p>
              {contact.username && contact.name !== `@${contact.username}` && <p className="truncate text-[12.5px] text-muted">{contact.name}</p>}
            </div>
          </div>
        </div>
        {already ? (
          <p className="flex items-start gap-2 rounded-[14px] bg-info-soft px-3.5 py-2.5 text-[13.5px] text-info">
            <UserRoundCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> {already.message}
          </p>
        ) : (
          <>
            <Field label="Origem">
              <p className="flex h-11 items-center rounded-[14px] border border-line bg-page/60 px-3.5 text-[14px]">{from === "comment" ? "Comentário do Instagram" : "Instagram Direct"}</p>
            </Field>
            <Field label="Produto de interesse" htmlFor="tl-product">
              <Select id="tl-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">{opts?.products.length ? "Selecionar" : "Nenhum produto cadastrado"}</option>
                {opts?.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Etapa inicial" htmlFor="tl-stage">
              <Select id="tl-stage" value={stageId} onChange={(e) => setStageId(e.target.value)}>
                {!opts && <option value="">Carregando…</option>}
                {opts?.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Responsável" htmlFor="tl-owner">
              <Select id="tl-owner" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {owners.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userId === me.user.id ? `${m.name} (você)` : m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Observação (opcional)" htmlFor="tl-note">
              <Textarea id="tl-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} placeholder="Ex.: perguntou sobre a mentoria e pediu valores." className="min-h-[76px]" />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
