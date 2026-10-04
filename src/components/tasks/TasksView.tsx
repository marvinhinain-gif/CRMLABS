"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CalendarClock, Ellipsis, Plus, SquareCheck, Trash2 } from "lucide-react";
import { api, ApiError, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useOpenContact, useQueryParam } from "@/lib/nav";
import { dayLabel, dueTone, formatDateTime, fromLocalInput, toLocalInput } from "@/lib/format";
import { Avatar, Button, Card, cx, DemoBadge, Dialog, EmptyState, ErrorState, Field, IconButton, Input, LoadingState, Menu, MenuContent, MenuItem, MenuTrigger, PageHeader, Select, Tabs, Textarea } from "@/components/ui";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  dueAt: string | null;
  status: "open" | "done";
  completedAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  contactId: string | null;
  contactName: string | null;
  opportunityTitle: string | null;
};
type TaskList = { rows: Task[]; counts: { today: number; overdue: number } };

function TaskDialog({ task, open, onOpenChange, onSaved }: { task: Task | null; open: boolean; onOpenChange: (v: boolean) => void; onSaved: () => void }) {
  const me = useMe();
  const team = useTeam();
  const [form, setForm] = useState({ title: "", notes: "", dueAt: "", ownerId: "" });
  const [contact, setContact] = useState<{ id: string; name: string } | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const { data: found } = useSWR<{ rows: { id: string; name: string }[] }>(open && q.length >= 2 && !contact ? `/api/contacts${qs({ q, pageSize: 5 })}` : null, fetcher);
  const [init, setInit] = useState<string | null>(null);
  const key = `${open}-${task?.id ?? "new"}`;
  if (open && init !== key) {
    setInit(key);
    setForm({ title: task?.title ?? "", notes: task?.notes ?? "", dueAt: toLocalInput(task?.dueAt), ownerId: task?.ownerId ?? me.user.id });
    setContact(task?.contactId ? { id: task.contactId, name: task.contactName ?? "Contato" } : null);
    setQ("");
    setFields({});
  }
  if (!open && init) setInit(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async () => {
    setLoading(true);
    const body = { title: form.title, notes: form.notes || null, dueAt: fromLocalInput(form.dueAt), ownerId: form.ownerId || null, contactId: contact?.id ?? null };
    try {
      if (task) await api.patch(`/api/tasks/${task.id}`, body);
      else await api.post("/api/tasks", body);
      toast.success(task ? "Tarefa atualizada." : "Tarefa criada.");
      onOpenChange(false);
      onSaved();
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
      title={task ? "Editar tarefa" : "Nova tarefa"}
      description="Tarefas geram apenas alertas internos — nenhum e-mail ou mensagem externa é enviado."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={loading} disabled={!form.title.trim()}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Título" htmlFor="tk-t" error={fields.title}>
          <Input id="tk-t" value={form.title} onChange={set("title")} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vencimento" htmlFor="tk-d">
            <Input id="tk-d" type="datetime-local" value={form.dueAt} onChange={set("dueAt")} />
          </Field>
          <Field label="Responsável" htmlFor="tk-o" error={fields.ownerId}>
            <Select id="tk-o" value={form.ownerId} onChange={set("ownerId")} disabled={!me.permissions.assign}>
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
        <Field label="Contato (opcional)" htmlFor="tk-c">
          {contact ? (
            <div className="flex items-center gap-3 rounded-[14px] border border-line px-3 py-2">
              <Avatar name={contact.name} size={28} />
              <span className="flex-1 text-[14px]">{contact.name}</span>
              <Button size="sm" variant="ghost" onClick={() => setContact(null)}>
                Remover
              </Button>
            </div>
          ) : (
            <>
              <Input id="tk-c" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contato" />
              {found?.rows.map((r) => (
                <button key={r.id} onClick={() => setContact(r)} className="mt-1 flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-[14px] hover:bg-page">
                  <Avatar name={r.name} size={26} /> {r.name}
                </button>
              ))}
            </>
          )}
        </Field>
        <Field label="Observação" htmlFor="tk-n">
          <Textarea id="tk-n" value={form.notes} onChange={set("notes")} />
        </Field>
      </div>
    </Dialog>
  );
}

export function TasksView() {
  const me = useMe();
  const team = useTeam();
  const openContact = useOpenContact();
  const [view, setView] = useQueryParam("visao", "today");
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [editing, setEditing] = useState<Task | null>(null);
  const [dialog, setDialog] = useState(false);
  const { data, error, isLoading, mutate } = useSWR<TaskList>(`/api/tasks${qs({ view, ownerId: owner, limit: 100 })}`, fetcher, { keepPreviousData: true });

  const toggle = async (t: Task) => {
    try {
      await api.patch(`/api/tasks/${t.id}`, { status: t.status === "done" ? "open" : "done" });
      toast.success(t.status === "done" ? "Tarefa reaberta." : "Tarefa concluída.");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const remove = async (t: Task) => {
    if (!confirm(`Excluir a tarefa "${t.title}"?`)) return;
    try {
      await api.del(`/api/tasks/${t.id}`);
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="Tarefas"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle="O que precisa ser feito, por quem e quando."
        actions={
          <Button
            icon={<Plus className="size-4" />}
            onClick={() => {
              setEditing(null);
              setDialog(true);
            }}
          >
            Nova tarefa
          </Button>
        }
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: "today", label: "Hoje", count: data?.counts.today },
            { value: "overdue", label: "Atrasadas", count: data?.counts.overdue },
            { value: "upcoming", label: "Próximas" },
            { value: "done", label: "Concluídas" },
          ]}
        />
        {me.permissions.dataAll && (
          <Select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="sm:w-[220px] bg-white">
            <option value="">Toda a equipe</option>
            {team.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <Card>
        {error ? (
          <ErrorState error={error} onRetry={() => mutate()} />
        ) : isLoading && !data ? (
          <LoadingState rows={5} className="p-4" />
        ) : !data?.rows.length ? (
          <EmptyState icon={<SquareCheck />} title={view === "done" ? "Nenhuma tarefa concluída" : view === "overdue" ? "Nada atrasado" : "Nenhuma tarefa aqui"} description="Crie tarefas para organizar os próximos passos com cada contato." />
        ) : (
          <ul className="divide-y divide-line">
            {data.rows.map((t) => {
              const tone = t.status === "open" ? dueTone(t.dueAt) : "none";
              return (
                <li key={t.id} className="flex items-start gap-2 sm:gap-4 px-3 sm:px-5 py-3 sm:py-4">
                  <label className="-m-1 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] hover:bg-page">
                    <input type="checkbox" checked={t.status === "done"} onChange={() => toggle(t)} aria-label={t.status === "done" ? `Reabrir ${t.title}` : `Concluir ${t.title}`} className="size-5 cursor-pointer accent-[#008a65]" />
                  </label>
                  <div className="min-w-0 flex-1">
                    <p className={cx("text-[15px] font-semibold", t.status === "done" && "line-through text-muted")}>{t.title}</p>
                    {t.notes && <p className="text-[13.5px] text-muted line-clamp-2">{t.notes}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                      {t.contactId && (
                        <button className="font-medium text-brand hover:underline" onClick={() => openContact(t.contactId!)}>
                          {t.contactName}
                        </button>
                      )}
                      {t.opportunityTitle && <span>Oportunidade: {t.opportunityTitle}</span>}
                      <span>{t.ownerName ?? "Sem responsável"}</span>
                      {t.status === "done" && t.completedAt && <span>Concluída {formatDateTime(t.completedAt)}</span>}
                    </p>
                    {t.dueAt && (
                      <span className={cx("mt-1.5 inline-flex sm:hidden items-center gap-1.5 text-[13px] font-medium", tone === "overdue" ? "text-danger" : tone === "today" ? "text-success" : "text-muted")}>
                        <CalendarClock className="size-4" aria-hidden />
                        {tone === "overdue" ? "Atrasada · " : ""}
                        {dayLabel(t.dueAt)}
                      </span>
                    )}
                  </div>
                  {t.dueAt && (
                    <span className={cx("hidden sm:inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium", tone === "overdue" ? "text-danger" : tone === "today" ? "text-success" : "text-muted")}>
                      <CalendarClock className="size-4" aria-hidden />
                      {tone === "overdue" ? "Atrasada · " : ""}
                      {dayLabel(t.dueAt)}
                    </span>
                  )}
                  <Menu>
                    <MenuTrigger asChild>
                      <IconButton label={`Ações para ${t.title}`} size="sm">
                        <Ellipsis className="size-5" />
                      </IconButton>
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem
                        onSelect={() => {
                          setEditing(t);
                          setDialog(true);
                        }}
                      >
                        Editar
                      </MenuItem>
                      <MenuItem onSelect={() => toggle(t)}>{t.status === "done" ? "Reabrir" : "Concluir"}</MenuItem>
                      <MenuItem icon={<Trash2 />} danger onSelect={() => remove(t)}>
                        Excluir
                      </MenuItem>
                    </MenuContent>
                  </Menu>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <TaskDialog task={editing} open={dialog} onOpenChange={setDialog} onSaved={() => mutate()} />
    </div>
  );
}
