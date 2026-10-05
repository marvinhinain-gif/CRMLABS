/**
 * Tipos de notificação e as preferências que o usuário pode ligar/desligar.
 * Compartilhado entre servidor e interface.
 */
export type NotifyPrefKey = "leads" | "leadStage" | "meeting" | "sale" | "messages" | "assignments" | "tasks" | "daily" | "access";

export const NOTIFY_PREFS: { key: NotifyPrefKey; label: string; description: string; adminOnly?: boolean }[] = [
  { key: "leads", label: "Novos leads de anúncio", description: "Quando um lead chega para você confirmar a reunião." },
  { key: "sale", label: "Venda fechada", description: "Valor, vendedor (closer) e social seller." },
  { key: "meeting", label: "Reunião agendada", description: "Quando alguém agenda uma reunião com um lead.", adminOnly: true },
  { key: "leadStage", label: "Lead mudou de etapa", description: "Movimentos no funil de relacionamento e no comercial.", adminOnly: true },
  { key: "messages", label: "Novas mensagens", description: "Mensagens do Direct em conversas suas." },
  { key: "assignments", label: "Leads, tarefas e reuniões para você", description: "Quando um lead é encaminhado ou algo é atribuído a você." },
  { key: "tasks", label: "Lembretes de tarefas", description: "30 minutos antes do prazo e quando a tarefa atrasa." },
  { key: "daily", label: "Bom dia e boa noite", description: "Mensagens curtas às 9h e às 21h para organizar o dia." },
  { key: "access", label: "Pedidos de acesso", description: "Pessoas pedindo para entrar na equipe.", adminOnly: true },
];

/** Tipo da notificação → preferência que a controla. */
export const TYPE_TO_PREF: Record<string, NotifyPrefKey> = {
  "lead.stage_changed": "leadStage",
  "opportunity.stage_changed": "leadStage",
  "meeting.scheduled": "meeting",
  "sale.won": "sale",
  "message.received": "messages",
  "task.assigned": "assignments",
  "meeting.assigned": "assignments",
  "lead.new": "leads",
  "lead.unassigned": "leads",
  "opportunity.assigned": "assignments",
  "opportunity.forwarded": "assignments",
  "member.requested": "access",
  "task.due_soon": "tasks",
  "task.overdue": "tasks",
  "daily.morning": "daily",
  "daily.evening": "daily",
};

/** Ligado por padrão; o usuário desliga o que não quiser. */
export function prefEnabled(prefs: Record<string, boolean> | null | undefined, type: string) {
  const key = TYPE_TO_PREF[type];
  if (!key) return true;
  return prefs?.[key] !== false;
}
