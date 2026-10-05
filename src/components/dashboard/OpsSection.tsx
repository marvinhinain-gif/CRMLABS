"use client";

import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { ArrowRight, Calendar, MessageCircle, Ellipsis } from "lucide-react";
import { api, fetcher, qs } from "@/lib/api";
import { useOpenContact } from "@/lib/nav";
import { dayLabel, dueTone, relativeTime } from "@/lib/format";
import { Avatar, Card, cx, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, StageChip } from "@/components/ui";
import { TeamAvatar } from "@/components/ui/TeamAvatar";
import { InstagramGlyph } from "@/components/ui/ChannelIcon";

type Task = { id: string; title: string; notes: string | null; dueAt: string | null; contactId: string | null; contactName: string | null };
type Ops = {
  tasks: { today: Task[]; overdue: Task[]; counts: { today: number; overdue: number } };
  awaiting: {
    conversationId: string;
    contactId: string;
    contactName: string;
    avatarUrl: string | null;
    channel: string;
    preview: string | null;
    lastMessageAt: string | null;
    ownerId: string | null;
    ownerName: string | null;
    stageName: string | null;
    stageColor: string | null;
  }[];
};

/** Rotina do dia (social seller e closer): próximas ações e conversas aguardando resposta. */
export function OpsSection({ showConversations = true }: { showConversations?: boolean }) {
  const openContact = useOpenContact();
  const { data, mutate } = useSWR<Ops>(`/api/dashboard${qs({ period: "today" })}`, fetcher);
  if (!data) return null;
  const completeTask = async (id: string) => {
    try {
      await api.patch(`/api/tasks/${id}`, { status: "done" });
      toast.success("Tarefa concluída.");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const tasks = [...data.tasks.overdue, ...data.tasks.today].slice(0, 4);
  return (
    <div className={cx("grid grid-cols-1 gap-6 [&>*]:min-w-0", showConversations && "xl:grid-cols-[1fr_1.4fr]")}>
      <Card className="p-5 sm:p-7 flex flex-col anim-rise" style={{ "--i": 8 } as React.CSSProperties}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[18px] sm:text-[20px] font-semibold">Próximas ações</h2>
          <Link href="/tarefas" className="inline-flex items-center gap-1 text-[14px] font-medium text-brand hover:underline">
            Ver tarefas <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <p className="mt-1 text-[12.5px] text-muted">
          {data.tasks.counts.today} para hoje · <span className={cx(data.tasks.counts.overdue > 0 && "text-danger font-medium")}>{data.tasks.counts.overdue} atrasada(s)</span>
        </p>
        {tasks.length === 0 ? (
          <EmptyState title="Nada pendente para hoje" description="Crie tarefas a partir do painel de um contato." className="flex-1 py-6" />
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-line">
            {tasks.map((t, i) => {
              const tone = dueTone(t.dueAt);
              return (
                <li key={t.id} className="anim-fade flex flex-wrap items-start gap-x-3 gap-y-1 py-3.5" style={{ "--i": i + 6 } as React.CSSProperties}>
                  <label className="-m-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] hover:bg-page">
                    <input
                      type="checkbox"
                      onChange={() => completeTask(t.id)}
                      aria-label={`Concluir: ${t.title}`}
                      className="size-5 cursor-pointer rounded-[6px] accent-[#008a65]"
                    />
                  </label>
                  <button className="min-w-0 flex-1 basis-[180px] text-left" onClick={() => t.contactId && openContact(t.contactId)} disabled={!t.contactId}>
                    <p className="text-[15px] font-semibold truncate">{t.title}</p>
                    <p className="text-[13px] text-muted truncate">{t.notes || t.contactName || "Sem contato vinculado"}</p>
                  </button>
                  <span
                    className={cx("ml-8 sm:ml-0 inline-flex items-center gap-1.5 whitespace-nowrap text-[13.5px]", tone === "overdue" ? "text-danger font-medium" : "text-ink")}
                  >
                    <Calendar className={cx("size-[18px]", tone === "overdue" ? "text-danger" : "text-brand")} aria-hidden />
                    {tone === "overdue" ? `Atrasada · ${dayLabel(t.dueAt)}` : dayLabel(t.dueAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/tarefas" className="mt-auto pt-4">
          <span className="flex h-11 items-center justify-center gap-2 rounded-[14px] border border-[#c9ebdc] bg-selected text-[14.5px] font-semibold text-brand hover:brightness-[0.98]">
            Ver todas as tarefas <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>
      </Card>
      {showConversations && (
        <Card className="p-5 sm:p-7 anim-rise" style={{ "--i": 9 } as React.CSSProperties}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h2 className="text-[18px] sm:text-[20px] font-semibold">Conversas que precisam de atenção</h2>
            <Link href="/instagram?aba=directs&filtro=pending" className="inline-flex items-center gap-1 text-[14px] font-medium text-brand hover:underline">
              Abrir conversas <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          {data.awaiting.length === 0 ? (
            <EmptyState
              icon={<MessageCircle />}
              title="Nenhuma conversa aguardando resposta"
              description="Mensagens recebidas pelo Instagram conectado aparecem aqui até alguém responder."
            />
          ) : (
            <>
              <ul className="mt-3 flex flex-col divide-y divide-line md:hidden">
                {data.awaiting.map((c, i) => (
                  <li key={c.conversationId} className="anim-fade py-3" style={{ "--i": i + 8 } as React.CSSProperties}>
                    <div className="flex items-start gap-3">
                      <button onClick={() => openContact(c.contactId)} className="shrink-0" aria-label={`Abrir ${c.contactName}`}>
                        <Avatar name={c.contactName} src={c.avatarUrl} size={44} />
                      </button>
                      <Link href={`/instagram?aba=directs&c=${c.conversationId}`} className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-semibold">{c.contactName}</span>
                          <InstagramGlyph size={16} className="shrink-0" />
                          <span className="ml-auto shrink-0 text-[12px] text-muted">{relativeTime(c.lastMessageAt)}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[14px] text-muted">{c.preview}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-2">
                          {c.stageName && <StageChip name={c.stageName} color={c.stageColor} />}
                          {c.ownerName && (
                            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-muted">
                              <TeamAvatar userId={c.ownerId} name={c.ownerName} size={20} /> {c.ownerName}
                            </span>
                          )}
                        </span>
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 overflow-x-auto hidden md:block">
                <table className="w-full min-w-[720px] text-left">
                  <thead>
                    <tr className="border-b border-line text-[13.5px] text-muted">
                      <th className="py-2.5 font-medium">Contato</th>
                      <th className="py-2.5 font-medium">Última mensagem</th>
                      <th className="py-2.5 font-medium">Etapa</th>
                      <th className="py-2.5 font-medium">Responsável</th>
                      <th className="py-2.5 w-10">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.awaiting.map((c, i) => (
                      <tr
                        key={c.conversationId}
                        className="anim-fade border-b border-line last:border-0 transition-colors hover:bg-page/60"
                        style={{ "--i": i + 8 } as React.CSSProperties}
                      >
                        <td className="py-3.5">
                          <button onClick={() => openContact(c.contactId)} className="flex items-center gap-3 text-left">
                            <Avatar name={c.contactName} src={c.avatarUrl} size={44} />
                            <span className="text-[15px] font-semibold">{c.contactName}</span>
                            <InstagramGlyph size={20} className="ml-4 hidden sm:block" />
                          </button>
                        </td>
                        <td className="py-3.5">
                          <Link href={`/instagram?aba=directs&c=${c.conversationId}`} className="block hover:underline">
                            <span className="block text-[14.5px] max-w-[300px] truncate">{c.preview}</span>
                            <span className="block text-[13px] text-muted">{relativeTime(c.lastMessageAt)}</span>
                          </Link>
                        </td>
                        <td className="py-3.5">
                          {c.stageName ? <StageChip name={c.stageName} color={c.stageColor} /> : <span className="text-muted text-[13px]">Fora do quadro</span>}
                        </td>
                        <td className="py-3.5">
                          {c.ownerName ? (
                            <span className="flex items-center gap-2.5 text-[14.5px]">
                              <TeamAvatar userId={c.ownerId} name={c.ownerName} size={36} />
                              {c.ownerName}
                            </span>
                          ) : (
                            <span className="text-[13.5px] text-muted">Sem responsável</span>
                          )}
                        </td>
                        <td className="py-3.5">
                          <Menu>
                            <MenuTrigger asChild>
                              <IconButton label={`Ações para ${c.contactName}`} size="sm">
                                <Ellipsis className="size-5" />
                              </IconButton>
                            </MenuTrigger>
                            <MenuContent>
                              <MenuItem onSelect={() => (window.location.href = `/instagram?aba=directs&c=${c.conversationId}`)}>Responder</MenuItem>
                              <MenuItem onSelect={() => openContact(c.contactId)}>Abrir contato</MenuItem>
                            </MenuContent>
                          </Menu>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
