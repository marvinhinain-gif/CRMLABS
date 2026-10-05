"use client";

import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Check, ExternalLink, GripVertical, Link2, ListChecks, Pencil, Plus, SquareCheck, Trash2, UserRound, X } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { dayLabel, dueTone, formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { Avatar, Button, cx, Dialog, ErrorState, Field, IconButton, Input, LoadingState, Select, Sheet, SheetClose, Textarea } from "@/components/ui";
import { ContactPicker, type PickedContact } from "@/components/contacts/ContactPicker";
import { useOpenContact } from "@/lib/nav";

export type Priority = "low" | "medium" | "high";
export type TaskStatus = "open" | "in_progress" | "done";

export const PRIORITY: Record<Priority, { label: string; dot: string; chip: string }> = {
  high: { label: "Alta", dot: "#d64545", chip: "bg-danger-soft text-danger" },
  medium: { label: "Média", dot: "#e0a106", chip: "bg-warning-soft text-warning" },
  low: { label: "Baixa", dot: "#8a9aa3", chip: "bg-[#eef2f1] text-[#46565f]" },
};
export const STATUS: Record<TaskStatus, { label: string; chip: string }> = {
  open: { label: "Pendente", chip: "bg-[#eef2f1] text-[#46565f]" },
  in_progress: { label: "Em andamento", chip: "bg-info-soft text-info" },
  done: { label: "Concluída", chip: "bg-success-soft text-success" },
};

export type TaskRow = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: TaskStatus;
  priority: Priority;
  ownerId: string | null;
  ownerName: string | null;
  contactId: string | null;
  contactName: string | null;
  checklistTotal: number;
  checklistDone: number;
  linkCount: number;
};

type ChecklistItem = { id: string; text: string; done: boolean; position: number };
type TaskLink = { id: string; title: string; url: string; description: string | null };
type TaskFull = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: TaskStatus;
  priority: Priority;
  ownerId: string | null;
  ownerName: string | null;
  createdByName: string | null;
  createdAt: string;
  contact: { id: string; name: string; avatarUrl: string | null; username: string | null } | null;
  checklist: ChecklistItem[];
  links: TaskLink[];
  canEdit: boolean;
};

export const refreshTasks = (mutate: ReturnType<typeof useSWRConfig>["mutate"]) =>
  mutate((k) => typeof k === "string" && (k.startsWith("/api/tasks") || k.startsWith("/api/dashboard") || k.startsWith("/api/contacts/") || k.startsWith("/api/commercial") || k.startsWith("/api/opportunities/")));

export function PriorityDot({ p, className }: { p: Priority; className?: string }) {
  return <span className={cx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: PRIORITY[p].dot }} title={`Prioridade ${PRIORITY[p].label.toLowerCase()}`} aria-label={`Prioridade ${PRIORITY[p].label.toLowerCase()}`} />;
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; dot?: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-[14px] bg-page p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx("flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-2 py-2 text-[13px] font-medium transition-colors", value === o.value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink")}
        >
          {o.dot && <span className="size-2 rounded-full" style={{ background: o.dot }} aria-hidden />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

// ---------- Nova tarefa ----------
export function NewTaskDialog({
  open,
  onOpenChange,
  contact,
  opportunityId,
  defaultOwnerId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contact?: PickedContact | null;
  opportunityId?: string | null;
  defaultOwnerId?: string | null;
  onCreated?: (id: string) => void;
}) {
  const me = useMe();
  const team = useTeam();
  const { mutate } = useSWRConfig();
  const blank = () => ({ title: "", notes: "", ownerId: defaultOwnerId ?? me.user.id, due: "", priority: "medium" as Priority, status: "open" as TaskStatus });
  const [f, setF] = useState(blank);
  const [lead, setLead] = useState<PickedContact | null>(contact ?? null);
  const [items, setItems] = useState<string[]>([]);
  const [item, setItem] = useState("");
  const [links, setLinks] = useState<{ title: string; url: string }[]>([]);
  const [link, setLink] = useState({ title: "", url: "" });
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setF(blank());
      setLead(contact ?? null);
      setItems([]);
      setLinks([]);
      setFields({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = <K extends keyof ReturnType<typeof blank>>(k: K, v: ReturnType<typeof blank>[K]) => setF((x) => ({ ...x, [k]: v }));
  const addItem = () => {
    if (!item.trim()) return;
    setItems((x) => [...x, item.trim()]);
    setItem("");
  };
  const addLink = () => {
    if (!link.title.trim() || !link.url.trim()) return;
    setLinks((x) => [...x, { title: link.title.trim(), url: link.url.trim() }]);
    setLink({ title: "", url: "" });
  };
  const submit = async () => {
    setBusy(true);
    setFields({});
    try {
      const t = await api.post<{ id: string }>("/api/tasks", {
        title: f.title,
        notes: f.notes || null,
        ownerId: f.ownerId || null,
        dueAt: f.due ? fromLocalInput(f.due) : null,
        priority: f.priority,
        status: f.status,
        contactId: lead?.id ?? null,
        opportunityId: opportunityId ?? null,
        checklist: items.length ? items : undefined,
        links: links.length ? links : undefined,
      });
      toast.success(f.ownerId && f.ownerId !== me.user.id ? "Tarefa criada e responsável avisado." : "Tarefa criada.");
      refreshTasks(mutate);
      onOpenChange(false);
      onCreated?.(t.id);
    } catch (e) {
      setFields((e as ApiError).fields);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Nova tarefa"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={busy} disabled={!f.title.trim()}>
            Criar tarefa
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Título" htmlFor="nt-title" error={fields.title}>
          <Input id="nt-title" autoFocus value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="Ex.: Preparar proposta comercial" maxLength={160} />
        </Field>
        <Field label="Descrição" htmlFor="nt-notes">
          <Textarea id="nt-notes" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Detalhes, contexto, combinados…" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Responsável" htmlFor="nt-owner" error={fields.ownerId}>
            <Select id="nt-owner" value={f.ownerId} onChange={(e) => set("ownerId", e.target.value)}>
              {team
                .filter((m) => m.status === "active")
                .map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.userId === me.user.id ? `${m.name} (eu)` : m.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Prazo" htmlFor="nt-due" error={fields.dueAt}>
            <Input id="nt-due" type="datetime-local" value={f.due} onChange={(e) => set("due", e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Prioridade">
            <Segmented label="Prioridade" value={f.priority} onChange={(v) => set("priority", v)} options={(["low", "medium", "high"] as Priority[]).map((p) => ({ value: p, label: PRIORITY[p].label, dot: PRIORITY[p].dot }))} />
          </Field>
          <Field label="Status">
            <Segmented label="Status" value={f.status} onChange={(v) => set("status", v)} options={(["open", "in_progress"] as TaskStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))} />
          </Field>
        </div>
        {!contact && (
          <Field label="Lead relacionado (opcional)">
            <ContactPicker value={lead} onChange={setLead} />
          </Field>
        )}
        <details className="rounded-[16px] border border-line p-3.5" open={items.length > 0}>
          <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-medium">
            <ListChecks className="size-4 text-brand" aria-hidden /> Checklist {items.length > 0 && <span className="text-muted">· {items.length}</span>}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {items.map((t, i) => (
              <li key={i} className="flex items-center gap-2 text-[14px]">
                <span className="size-4 rounded-[5px] border-2 border-[#b7c6c1]" aria-hidden />
                <span className="flex-1">{t}</span>
                <IconButton label={`Remover ${t}`} size="sm" onClick={() => setItems((x) => x.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Input aria-label="Novo item do checklist" value={item} onChange={(e) => setItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addItem())} placeholder="Ex.: Revisar diagnóstico" />
            <Button variant="secondary" onClick={addItem} disabled={!item.trim()}>
              Adicionar
            </Button>
          </div>
        </details>
        <details className="rounded-[16px] border border-line p-3.5" open={links.length > 0}>
          <summary className="flex cursor-pointer items-center gap-2 text-[14px] font-medium">
            <Link2 className="size-4 text-brand" aria-hidden /> Materiais {links.length > 0 && <span className="text-muted">· {links.length}</span>}
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {links.map((l, i) => (
              <li key={i} className="flex items-center gap-2 text-[14px]">
                <Link2 className="size-4 text-muted" aria-hidden />
                <span className="flex-1 truncate">
                  {l.title} <span className="text-muted">· {domainOf(/^https?:/.test(l.url) ? l.url : `https://${l.url}`)}</span>
                </span>
                <IconButton label={`Remover ${l.title}`} size="sm" onClick={() => setLinks((x) => x.filter((_, j) => j !== i))}>
                  <X className="size-4" />
                </IconButton>
              </li>
            ))}
          </ul>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.4fr_auto]">
            <Input aria-label="Nome do material" value={link.title} onChange={(e) => setLink((x) => ({ ...x, title: e.target.value }))} placeholder="Proposta comercial" />
            <Input aria-label="Link do material" value={link.url} onChange={(e) => setLink((x) => ({ ...x, url: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLink())} placeholder="https://…" />
            <Button variant="secondary" onClick={addLink} disabled={!link.title.trim() || !link.url.trim()}>
              Adicionar
            </Button>
          </div>
        </details>
      </div>
    </Dialog>
  );
}

// ---------- Checklist ----------
function SortableItem({ item, disabled, onToggle, onRename, onDelete }: { item: ChecklistItem; disabled: boolean; onToggle: () => void; onRename: (t: string) => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState(item.text);
  useEffect(() => setText(item.text), [item.text]);
  const commit = () => {
    setEdit(false);
    if (text.trim() && text.trim() !== item.text) onRename(text.trim());
    else setText(item.text);
  };
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx("group flex items-center gap-2 rounded-[12px] bg-white px-1.5 py-1", isDragging && "relative z-10 shadow-[var(--shadow-pop)]")}>
      {!disabled && (
        <button className="cursor-grab touch-none p-1 text-[#9fb0aa] opacity-60 group-hover:opacity-100" aria-label={`Reordenar ${item.text}`} {...attributes} {...listeners}>
          <GripVertical className="size-4" />
        </button>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={item.done}
        aria-label={item.done ? `Desmarcar ${item.text}` : `Concluir ${item.text}`}
        disabled={disabled}
        onClick={onToggle}
        className={cx("flex size-5 shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors", item.done ? "border-brand bg-brand text-white" : "border-[#b7c6c1] hover:border-brand")}
      >
        {item.done && <Check className="size-3.5" strokeWidth={3} />}
      </button>
      {edit ? (
        <Input autoFocus aria-label="Editar item" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => (e.key === "Enter" ? commit() : e.key === "Escape" && (setText(item.text), setEdit(false)))} className="h-9" />
      ) : (
        <span className={cx("flex-1 text-[14px]", item.done && "text-muted line-through")} onDoubleClick={() => !disabled && setEdit(true)}>
          {item.text}
        </span>
      )}
      {!disabled && !edit && (
        <span className="flex opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <IconButton label={`Editar ${item.text}`} size="sm" onClick={() => setEdit(true)}>
            <Pencil className="size-3.5" />
          </IconButton>
          <IconButton label={`Excluir ${item.text}`} size="sm" onClick={onDelete}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </span>
      )}
    </li>
  );
}

function Checklist({ task, onChange }: { task: TaskFull; onChange: () => void }) {
  const [items, setItems] = useState(task.checklist);
  const [text, setText] = useState("");
  useEffect(() => setItems(task.checklist), [task.checklist]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const done = items.filter((i) => i.done).length;
  const pct = items.length ? Math.round((done / items.length) * 100) : 0;
  const call = async (p: Promise<unknown>) => {
    try {
      await p;
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
      onChange();
    }
  };
  const add = async () => {
    if (!text.trim()) return;
    const t = text.trim();
    setText("");
    await call(api.post(`/api/tasks/${task.id}/checklist`, { text: t }));
  };
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(items, items.findIndex((i) => i.id === e.active.id), items.findIndex((i) => i.id === e.over!.id));
    setItems(next);
    void call(api.post(`/api/tasks/${task.id}/checklist/reorder`, { orderedIds: next.map((i) => i.id) }));
  };
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <ListChecks className="size-4 text-brand" aria-hidden /> Checklist
        </h3>
        {items.length > 0 && (
          <span className="text-[13px] text-muted">
            {done} de {items.length} concluídos — <b className={cx("font-semibold", pct === 100 ? "text-brand" : "text-ink")}>{pct}%</b>
          </span>
        )}
      </div>
      {items.length > 0 && (
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#eef3f1]" aria-hidden>
          <span className="block h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="mt-2 flex flex-col">
            {items.map((i) => (
              <SortableItem
                key={i.id}
                item={i}
                disabled={!task.canEdit}
                onToggle={() => {
                  setItems((x) => x.map((y) => (y.id === i.id ? { ...y, done: !y.done } : y)));
                  void call(api.patch(`/api/tasks/${task.id}/checklist/${i.id}`, { done: !i.done }));
                }}
                onRename={(t) => void call(api.patch(`/api/tasks/${task.id}/checklist/${i.id}`, { text: t }))}
                onDelete={() => {
                  setItems((x) => x.filter((y) => y.id !== i.id));
                  void call(api.del(`/api/tasks/${task.id}/checklist/${i.id}`));
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      {task.canEdit && (
        <div className="mt-2 flex gap-2">
          <Input aria-label="Novo item do checklist" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="Adicionar item" className="h-10" />
          <Button variant="secondary" size="sm" className="h-10" icon={<Plus className="size-4" />} onClick={add} disabled={!text.trim()}>
            Item
          </Button>
        </div>
      )}
    </section>
  );
}

// ---------- Materiais ----------
function Materials({ task, onChange }: { task: TaskFull; onChange: () => void }) {
  const [form, setForm] = useState<{ id?: string; title: string; url: string; description: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const save = async () => {
    if (!form) return;
    setBusy(true);
    setErr({});
    try {
      const body = { title: form.title, url: form.url, description: form.description || null };
      if (form.id) await api.patch(`/api/tasks/${task.id}/links/${form.id}`, body);
      else await api.post(`/api/tasks/${task.id}/links`, body);
      setForm(null);
      onChange();
    } catch (e) {
      setErr((e as ApiError).fields);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (l: TaskLink) => {
    try {
      await api.del(`/api/tasks/${task.id}/links/${l.id}`);
      onChange();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[15px] font-semibold">
          <Link2 className="size-4 text-brand" aria-hidden /> Materiais
        </h3>
        {task.canEdit && !form && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setForm({ title: "", url: "", description: "" })}>
            Adicionar
          </Button>
        )}
      </div>
      {task.links.length === 0 && !form && <p className="mt-1.5 text-[13px] text-muted">Proposta, gravação da reunião, documentos do cliente, briefing…</p>}
      <ul className="mt-2 grid gap-2 sm:grid-cols-2">
        {task.links.map((l) => (
          <li key={l.id} className="group relative">
            <a href={l.url} target="_blank" rel="noreferrer noopener" className="flex h-full items-start gap-3 rounded-[16px] border border-line p-3 pr-9 transition-colors hover:border-brand hover:bg-selected/40">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-selected text-brand" aria-hidden>
                <Link2 className="size-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold">{l.title}</span>
                <span className="block truncate text-[12px] text-muted">{l.description || domainOf(l.url)}</span>
              </span>
              <ExternalLink className="absolute right-3 top-3.5 size-3.5 text-muted" aria-hidden />
            </a>
            {task.canEdit && (
              <span className="absolute bottom-1.5 right-1.5 flex rounded-[10px] bg-white opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                <IconButton label={`Editar ${l.title}`} size="sm" onClick={() => setForm({ id: l.id, title: l.title, url: l.url, description: l.description ?? "" })}>
                  <Pencil className="size-3.5" />
                </IconButton>
                <IconButton label={`Excluir ${l.title}`} size="sm" onClick={() => remove(l)}>
                  <Trash2 className="size-3.5" />
                </IconButton>
              </span>
            )}
          </li>
        ))}
      </ul>
      {form && (
        <div className="mt-2 flex flex-col gap-2.5 rounded-[16px] border border-dashed border-[#bfd6cf] p-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Nome" htmlFor="ml-title" error={err.title}>
              <Input id="ml-title" autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Proposta comercial" />
            </Field>
            <Field label="Link" htmlFor="ml-url" error={err.url}>
              <Input id="ml-url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Descrição (opcional)" htmlFor="ml-desc">
            <Input id="ml-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Versão enviada em 05/10" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setForm(null)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={save} loading={busy} disabled={!form.title.trim() || !form.url.trim()}>
              Salvar
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Tarefa (painel) ----------
export function TaskSheet({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const team = useTeam();
  const openContact = useOpenContact();
  const { mutate: gm } = useSWRConfig();
  const { data: t, error, mutate } = useSWR<TaskFull>(taskId ? `/api/tasks/${taskId}` : null, fetcher);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (t) {
      setTitle(t.title);
      setNotes(t.notes ?? "");
    }
  }, [t]);
  const refresh = () => {
    mutate();
    refreshTasks(gm);
  };
  const patch = async (body: Record<string, unknown>) => {
    try {
      await api.patch(`/api/tasks/${taskId}`, body);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
      mutate();
    }
  };
  const remove = async () => {
    if (!confirm("Excluir esta tarefa?")) return;
    try {
      await api.del(`/api/tasks/${taskId}`);
      toast.success("Tarefa excluída.");
      refreshTasks(gm);
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const tone = t ? dueTone(t.dueAt) : "none";
  return (
    <Sheet open={!!taskId} onOpenChange={(v) => !v && onClose()} title={t?.title ?? "Tarefa"} width={600}>
      {error ? (
        <div className="p-6">
          <ErrorState error={error} />
        </div>
      ) : !t ? (
        <div className="p-6">
          <LoadingState rows={5} />
        </div>
      ) : (
        <>
          <div className="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
            <button
              type="button"
              role="checkbox"
              aria-checked={t.status === "done"}
              aria-label={t.status === "done" ? "Reabrir tarefa" : "Concluir tarefa"}
              disabled={!t.canEdit}
              onClick={() => patch({ status: t.status === "done" ? "open" : "done" })}
              className={cx("mt-1 flex size-7 shrink-0 items-center justify-center rounded-[9px] border-2 transition-colors", t.status === "done" ? "border-brand bg-brand text-white" : "border-[#b7c6c1] hover:border-brand")}
            >
              {t.status === "done" && <Check className="size-4" strokeWidth={3} />}
            </button>
            <div className="min-w-0 flex-1">
              {t.canEdit ? (
                <input
                  aria-label="Título"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => title.trim() && title !== t.title && patch({ title: title.trim() })}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className={cx("w-full rounded-[10px] bg-transparent px-1 -mx-1 text-[19px] font-semibold outline-none focus:bg-page", t.status === "done" && "line-through text-muted")}
                />
              ) : (
                <p className="text-[19px] font-semibold">{t.title}</p>
              )}
              <p className="text-[12.5px] text-muted">
                Criada por {t.createdByName ?? "—"} em {formatDateTime(t.createdAt)}
              </p>
            </div>
            <SheetClose asChild>
              <IconButton label="Fechar">
                <X className="size-5" />
              </IconButton>
            </SheetClose>
          </div>
          <div className="flex-1 overflow-y-auto scroll-thin px-5 py-5 sm:px-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Status">
                <Segmented label="Status" value={t.status} onChange={(v) => t.canEdit && patch({ status: v })} options={(["open", "in_progress", "done"] as TaskStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))} />
              </Field>
              <Field label="Prioridade">
                <Segmented label="Prioridade" value={t.priority} onChange={(v) => t.canEdit && patch({ priority: v })} options={(["low", "medium", "high"] as Priority[]).map((p) => ({ value: p, label: PRIORITY[p].label, dot: PRIORITY[p].dot }))} />
              </Field>
              <Field label="Responsável" htmlFor="ts-owner">
                <Select id="ts-owner" value={t.ownerId ?? ""} disabled={!t.canEdit} onChange={(e) => patch({ ownerId: e.target.value })}>
                  {team
                    .filter((m) => m.status === "active" || m.userId === t.ownerId)
                    .map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Prazo" htmlFor="ts-due" hint={tone === "overdue" && t.status !== "done" ? "Atrasada" : undefined}>
                <Input id="ts-due" type="datetime-local" disabled={!t.canEdit} defaultValue={toLocalInput(t.dueAt)} key={t.dueAt ?? "none"} onBlur={(e) => e.target.value !== toLocalInput(t.dueAt) && patch({ dueAt: e.target.value ? fromLocalInput(e.target.value) : null })} invalid={tone === "overdue" && t.status !== "done"} />
              </Field>
            </div>
            <div className="mt-4">
              <p className="mb-1.5 text-[14px] font-medium">Lead relacionado</p>
              {t.contact ? (
                <button onClick={() => openContact(t.contact!.id)} className="flex w-full items-center gap-3 rounded-[14px] border border-line px-3 py-2 text-left hover:bg-page">
                  <Avatar name={t.contact.name} src={t.contact.avatarUrl} size={32} />
                  <span className="flex-1 truncate text-[14px] font-medium">{t.contact.name}</span>
                  <span className="text-[12.5px] text-brand">Abrir</span>
                </button>
              ) : t.canEdit ? (
                <ContactPicker value={null} onChange={(c) => c && patch({ contactId: c.id })} placeholder="Vincular a um lead (opcional)" />
              ) : (
                <p className="text-[13.5px] text-muted">Nenhum</p>
              )}
            </div>
            <Field label="Descrição" htmlFor="ts-notes" className="mt-4">
              <Textarea id="ts-notes" rows={4} readOnly={!t.canEdit} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (t.notes ?? "") && patch({ notes: notes || null })} placeholder="Adicione informações detalhadas…" />
            </Field>
            <div className="mt-6 flex flex-col gap-6">
              <Checklist task={t} onChange={refresh} />
              <Materials task={t} onChange={refresh} />
            </div>
          </div>
          {t.canEdit && (
            <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3 sm:px-6">
              <Button variant="ghost" size="sm" icon={<Trash2 className="size-4" />} onClick={remove}>
                Excluir
              </Button>
              <Button size="sm" icon={<SquareCheck className="size-4" />} variant={t.status === "done" ? "secondary" : "primary"} onClick={() => patch({ status: t.status === "done" ? "open" : "done" })}>
                {t.status === "done" ? "Reabrir" : "Concluir tarefa"}
              </Button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}

// ---------- Linha de tarefa (listas) ----------
export function TaskLine({ t, onOpen, onToggle, showContact = true }: { t: TaskRow; onOpen: () => void; onToggle?: () => void; showContact?: boolean }) {
  const tone = t.status === "done" ? "none" : dueTone(t.dueAt);
  return (
    <div className="group flex items-start gap-3 py-3">
      {onToggle && (
        <button
          type="button"
          role="checkbox"
          aria-checked={t.status === "done"}
          aria-label={t.status === "done" ? `Reabrir ${t.title}` : `Concluir ${t.title}`}
          onClick={onToggle}
          className={cx("mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-[7px] border-2 transition-colors", t.status === "done" ? "border-brand bg-brand text-white" : "border-[#b7c6c1] hover:border-brand")}
        >
          {t.status === "done" && <Check className="size-3.5" strokeWidth={3} />}
        </button>
      )}
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="flex items-center gap-2">
          <PriorityDot p={t.priority} />
          <span className={cx("truncate text-[14.5px] font-semibold", t.status === "done" && "text-muted line-through")}>{t.title}</span>
          {t.status === "in_progress" && <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS.in_progress.chip)}>Em andamento</span>}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
          {t.dueAt && (
            <span className={cx("inline-flex items-center gap-1", tone === "overdue" && "font-medium text-danger", tone === "today" && "text-success")}>
              <CalendarClock className="size-3.5" aria-hidden />
              {tone === "overdue" ? `Atrasada · ${dayLabel(t.dueAt)}` : `Prazo: ${dayLabel(t.dueAt)}`}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <UserRound className="size-3.5" aria-hidden /> {t.ownerName ?? "—"}
          </span>
          {showContact && t.contactName && <span className="truncate">· {t.contactName}</span>}
          {t.checklistTotal > 0 && (
            <span className={cx("inline-flex items-center gap-1", t.checklistDone === t.checklistTotal && "text-brand")}>
              <ListChecks className="size-3.5" aria-hidden /> {t.checklistDone}/{t.checklistTotal}
            </span>
          )}
          {t.linkCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Link2 className="size-3.5" aria-hidden /> {t.linkCount}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

/** Tarefas do lead, dentro da página dele (closer acessa tudo sem sair do contexto). */
export function LeadTasks({ contact, opportunityId, defaultOwnerId }: { contact: PickedContact; opportunityId?: string | null; defaultOwnerId?: string | null }) {
  const { mutate: gm } = useSWRConfig();
  const { data, mutate } = useSWR<{ rows: TaskRow[] }>(`/api/tasks${qs({ view: "all", contactId: contact.id, limit: 50 })}`, fetcher);
  const [open, setOpen] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const rows = data?.rows ?? [];
  const pending = rows.filter((r) => r.status !== "done");
  const done = rows.filter((r) => r.status === "done");
  const toggle = async (t: TaskRow) => {
    mutate({ rows: rows.map((r) => (r.id === t.id ? { ...r, status: t.status === "done" ? "open" : "done" } : r)) }, { revalidate: false });
    try {
      await api.patch(`/api/tasks/${t.id}`, { status: t.status === "done" ? "open" : "done" });
    } catch (e) {
      toast.error((e as Error).message);
    }
    refreshTasks(gm);
  };
  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Tarefas {pending.length > 0 && `· ${pending.length}`}</h3>
        <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>
          Nova tarefa
        </Button>
      </div>
      {!data ? (
        <div className="skeleton mt-2 h-14" />
      ) : rows.length === 0 ? (
        <p className="mt-1 text-[13.5px] text-muted">Nenhuma tarefa para este lead.</p>
      ) : (
        <div className="mt-1 divide-y divide-line">
          {[...pending, ...done.slice(0, 3)].map((t) => (
            <TaskLine key={t.id} t={t} showContact={false} onOpen={() => setOpen(t.id)} onToggle={() => toggle(t)} />
          ))}
        </div>
      )}
      <NewTaskDialog open={create} onOpenChange={setCreate} contact={contact} opportunityId={opportunityId} defaultOwnerId={defaultOwnerId} />
      <TaskSheet taskId={open} onClose={() => setOpen(null)} />
    </section>
  );
}
