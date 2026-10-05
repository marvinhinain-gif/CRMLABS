"use client";

import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { CalendarClock, CalendarDays, CircleAlert, CircleCheck, ListTodo, Plus, Search, SquareCheck } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import { useMe, useTeam } from "@/lib/me";
import { useQueryParam } from "@/lib/nav";
import { Button, Card, cx, DemoBadge, EmptyState, ErrorState, Input, LoadingState, PageHeader, Select, Tabs } from "@/components/ui";
import { NewTaskDialog, PRIORITY, refreshTasks, TaskLine, TaskSheet, type Priority, type TaskRow } from "./TaskParts";

type TaskList = { rows: TaskRow[]; counts: { today: number; overdue: number; upcoming: number; inProgress: number } };

const VIEWS = [
  { value: "today", label: "Hoje", icon: <CalendarDays /> },
  { value: "overdue", label: "Atrasadas", icon: <CircleAlert /> },
  { value: "upcoming", label: "Próximas", icon: <CalendarClock /> },
  { value: "done", label: "Concluídas", icon: <CircleCheck /> },
] as const;

export function TasksView() {
  const me = useMe();
  const team = useTeam();
  const { mutate: gm } = useSWRConfig();
  const [view, setView] = useQueryParam("aba", "today");
  const [owner, setOwner] = useQueryParam("responsavel", "");
  const [priority, setPriority] = useQueryParam("prioridade", "");
  const [status, setStatus] = useQueryParam("status", "");
  const [taskId, setTaskId] = useQueryParam("tarefa", "");
  const [q, setQ] = useState("");
  const [create, setCreate] = useState(false);
  const key = `/api/tasks${qs({ view, ownerId: owner, priority, status: view === "done" ? "" : status, q: q.trim().length >= 2 ? q.trim() : "", limit: 200 })}`;
  const { data, error, isLoading, mutate } = useSWR<TaskList>(key, fetcher, { keepPreviousData: true });

  const toggle = async (t: TaskRow) => {
    const next = t.status === "done" ? "open" : "done";
    mutate(data && { ...data, rows: data.rows.filter((r) => r.id !== t.id) }, { revalidate: false });
    try {
      await api.patch(`/api/tasks/${t.id}`, { status: next });
      if (next === "done") toast.success("Tarefa concluída.", { action: { label: "Desfazer", onClick: () => api.patch(`/api/tasks/${t.id}`, { status: "open" }).then(() => refreshTasks(gm)) } });
    } catch (e) {
      toast.error((e as Error).message);
    }
    refreshTasks(gm);
  };

  const counts = data?.counts;
  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-5">
      <PageHeader
        title="Tarefas"
        badge={me.org.isDemo ? <DemoBadge /> : undefined}
        subtitle="Follow-ups, propostas e combinados — com checklist, materiais e prazo."
        actions={
          <Button size="lg" icon={<Plus className="size-5" />} onClick={() => setCreate(true)} className="rounded-[16px] w-full sm:w-auto">
            Nova tarefa
          </Button>
        }
      />
      <Tabs
        value={view}
        onChange={setView}
        className="self-start max-w-full overflow-x-auto"
        items={VIEWS.map((v) => ({ ...v, count: v.value === "today" ? counts?.today : v.value === "overdue" ? counts?.overdue : v.value === "upcoming" ? counts?.upcoming : undefined }))}
      />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <Input aria-label="Buscar tarefa" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título ou lead" className="bg-white pl-10" />
        </div>
        <Select aria-label="Prioridade" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-auto bg-white">
          <option value="">Toda prioridade</option>
          {(["high", "medium", "low"] as Priority[]).map((p) => (
            <option key={p} value={p}>
              Prioridade {PRIORITY[p].label.toLowerCase()}
            </option>
          ))}
        </Select>
        {view !== "done" && (
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto bg-white">
            <option value="">Pendentes e em andamento</option>
            <option value="open">Só pendentes</option>
            <option value="in_progress">Só em andamento{counts?.inProgress ? ` (${counts.inProgress})` : ""}</option>
          </Select>
        )}
        {me.permissions.dataAll && (
          <Select aria-label="Responsável" value={owner} onChange={(e) => setOwner(e.target.value)} className="w-auto bg-white">
            <option value="">Toda a equipe</option>
            {team
              .filter((m) => m.status === "active")
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </Select>
        )}
      </div>

      {error && !data ? (
        <Card>
          <ErrorState error={error} onRetry={() => mutate()} />
        </Card>
      ) : isLoading && !data ? (
        <LoadingState rows={5} />
      ) : !data?.rows.length ? (
        <Card>
          <EmptyState
            icon={view === "done" ? <SquareCheck /> : <ListTodo />}
            title={view === "today" ? "Nada para hoje" : view === "overdue" ? "Nenhuma tarefa atrasada" : view === "upcoming" ? "Nenhuma tarefa futura" : "Nenhuma tarefa concluída"}
            description={view === "done" ? undefined : "Crie tarefas com prazo, checklist e materiais — também pela página de cada lead."}
            action={
              view !== "done" ? (
                <Button icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>
                  Nova tarefa
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className={cx("divide-y divide-line px-4 sm:px-5", isLoading && "opacity-70")}>
          {data.rows.map((t, i) => (
            <div key={t.id} className="anim-fade" style={{ "--i": Math.min(i, 12) } as React.CSSProperties}>
              <TaskLine t={t} onOpen={() => setTaskId(t.id)} onToggle={() => toggle(t)} />
            </div>
          ))}
        </Card>
      )}
      <NewTaskDialog open={create} onOpenChange={setCreate} onCreated={(id) => setTaskId(id)} />
      <TaskSheet taskId={taskId || null} onClose={() => setTaskId("")} />
    </div>
  );
}
