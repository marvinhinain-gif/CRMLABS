/**
 * Histórico de acessos e atividades da equipe: rótulos e categorias compartilhados
 * entre cliente e servidor (sem imports de servidor).
 */
import { OUTCOME_LABEL, type CadenceActivityOutcome } from "./cadence";

export const ACTIVITY_CATEGORIES = ["access", "leads", "instagram", "commercial", "contacts", "tasks", "forms", "settings"] as const;
export type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];

export const ACTIVITY_CATEGORY_LABEL: Record<ActivityCategory, string> = {
  access: "Acessos",
  leads: "Leads e Kanban",
  instagram: "Instagram",
  commercial: "Comercial",
  contacts: "Contatos",
  tasks: "Tarefas e agenda",
  forms: "Formulários",
  settings: "Configurações e equipe",
};

/**
 * Prefixos de ação de cada categoria. A ordem importa: o primeiro que casar define a categoria
 * (ex.: "instagram.lead_" é de Leads, o resto de "instagram." é Instagram).
 */
export const ACTIVITY_CATEGORY_PREFIXES: [ActivityCategory, string[]][] = [
  ["access", ["auth."]],
  ["leads", ["lead.", "instagram.lead_", "board.", "cadence.", "engagement."]],
  ["instagram", ["instagram.", "comment."]],
  ["commercial", ["opportunity.", "appointment.", "goal.", "checkout."]],
  ["contacts", ["contact.", "contacts.", "conversation.", "privacy."]],
  ["tasks", ["task.", "team_event.", "calendar.", "agenda."]],
  ["forms", ["form.", "quiz.", "integration.", "lead_source.", "product.", "custom_field."]],
  ["settings", []],
];

export function activityCategory(action: string): ActivityCategory {
  for (const [cat, prefixes] of ACTIVITY_CATEGORY_PREFIXES) if (prefixes.some((p) => action.startsWith(p))) return cat;
  return "settings";
}

const LABELS: Record<string, string> = {
  // Acessos
  "auth.login": "Entrou no CRM",
  "auth.session_resumed": "Voltou ao CRM",
  "auth.logout": "Saiu do CRM",
  "auth.login_failed": "Errou a senha ao tentar entrar",
  "auth.invite_accepted": "Aceitou o convite e entrou pela primeira vez",
  "auth.password_changed": "Trocou a senha",
  "auth.password_reset": "Criou uma nova senha pelo link",
  // Leads e Kanban
  "lead.updated": "Atualizou um lead",
  "lead.added_to_board": "Adicionou um lead ao CRM do Social Seller",
  "lead.forwarded_to_kanban": "Encaminhou um lead para o Kanban",
  "lead.scheduled": "Agendou reunião com um lead",
  "lead.shared": "Criou o link de compartilhamento da ficha de um lead",
  "lead.unshared": "Desativou o link da ficha de um lead",
  "lead.received": "Recebeu um lead",
  "instagram.lead_created": "Transformou em Lead",
  "instagram.lead_forwarded": "Encaminhou um lead para o closer",
  "instagram.lead_review_kept": "Manteve um lead na revisão",
  "instagram.lead_review_removed": "Removeu um lead na revisão",
  "board.card_added": "Colocou um contato no Kanban",
  "board.card_moved": "Moveu um cartão no Kanban",
  "board.card_removed": "Tirou um cartão do Kanban",
  "board.cleanup": "Limpou o quadro do Social Seller",
  "cadence.action": "Registrou na cadência",
  "cadence.steps_saved": "Editou a cadência",
  "engagement.icp_set": "Marcou ICP no Top Engajados",
  "engagement.contact_created": "Criou contato a partir do Top Engajados",
  "engagement.config_updated": "Mudou a pontuação do Top Engajados",
  // Instagram
  "instagram.dm_sent": "Enviou mensagem no Direct",
  "instagram.dm_resolved": "Marcou conversa como respondida",
  "instagram.dm_reopened": "Reabriu uma conversa",
  "instagram.comment_replied": "Respondeu um comentário",
  "instagram.comment_resolved": "Marcou comentário como respondido",
  "instagram.comment_reopened": "Reabriu um comentário",
  "instagram.comments_resolved_all": "Marcou todos os comentários de um post como respondidos",
  "instagram.comment_hidden": "Ocultou um comentário",
  "instagram.comment_unhidden": "Mostrou um comentário",
  "instagram.comment_deleted": "Apagou um comentário",
  "instagram.post_commented": "Comentou num post",
  "comment.linked": "Ligou um comentário a um contato",
  // Comercial
  "opportunity.created": "Criou uma oportunidade",
  "opportunity.updated": "Editou uma oportunidade",
  "opportunity.won": "Registrou venda ganha",
  "opportunity.lost": "Registrou venda perdida",
  "opportunity.reopened": "Reabriu uma oportunidade",
  "appointment.created": "Criou um agendamento",
  "appointment.status": "Mudou a situação de um agendamento",
  "goal.set": "Definiu meta de vendas",
  "checkout.settings_saved": "Mudou a integração da Cakto",
  "checkout.url_regenerated": "Gerou novo link do webhook da Cakto",
  "checkout.imported": "Importou vendas da Cakto",
  // Contatos
  "contact.created": "Criou um contato",
  "contact.archived": "Arquivou um contato",
  "contact.merged": "Juntou contatos duplicados",
  "contact.assigned": "Trocou o responsável de um contato",
  "contact.touchpoint": "Registrou um ponto de contato",
  "contact.note_added": "Escreveu uma nota",
  "contact.tags_set": "Mudou as etiquetas de um contato",
  "contacts.imported": "Importou contatos",
  "conversation.assigned": "Trocou o responsável de uma conversa",
  "privacy.export": "Exportou os dados de um contato (privacidade)",
  "privacy.anonymized": "Anonimizou um contato (privacidade)",
  "privacy.request_resolved": "Concluiu um pedido de privacidade",
  // Tarefas e agenda
  "task.created": "Criou uma tarefa",
  "task.assigned": "Atribuiu uma tarefa",
  "task.started": "Começou uma tarefa",
  "task.completed": "Concluiu uma tarefa",
  "task.reopened": "Reabriu uma tarefa",
  "task.deleted": "Apagou uma tarefa",
  "team_event.created": "Criou um compromisso na Agenda da equipe",
  "team_event.updated": "Editou um compromisso na Agenda da equipe",
  "team_event.canceled": "Cancelou um compromisso na Agenda da equipe",
  "agenda.work_hours": "Mudou o horário de atendimento",
  "agenda.canceled": "Cancelou um compromisso",
  "calendar.google_connected": "Conectou o Google Agenda",
  "calendar.google_disconnected": "Desconectou o Google Agenda",
  "calendar.feed_regenerated": "Gerou novo link da agenda",
  // Formulários
  "form.created": "Criou um formulário",
  "form.duplicated": "Duplicou um formulário",
  "form.draft_saved": "Editou um formulário",
  "form.published": "Publicou um formulário",
  "form.unpublished": "Despublicou um formulário",
  "form.archived": "Arquivou um formulário",
  "form.restored": "Restaurou um formulário",
  "form.deleted": "Apagou um formulário",
  "form.exported": "Exportou as respostas de um formulário",
  "form.recalculated": "Recalculou as notas de um formulário",
  "form.scoring_draft_changed": "Mudou as regras de pontuação (rascunho)",
  "form.scoring_published": "Publicou as regras de pontuação",
  "quiz.recommendation_overridden": "Ajustou a recomendação de uma resposta",
  "integration.created": "Criou uma integração de leads",
  "integration.updated": "Editou uma integração de leads",
  "integration.deleted": "Apagou uma integração de leads",
  "integration.token_regenerated": "Gerou novo token de integração",
  "integration.signing_secret": "Mudou o segredo de uma integração",
  "integration.connected": "Conectou o Instagram",
  "integration.disconnected": "Desconectou o Instagram",
  "lead_source.created": "Criou uma origem de lead",
  "product.created": "Criou um produto",
  "custom_field.created": "Criou um campo personalizado",
  // Configurações e equipe
  "member.invited": "Convidou uma pessoa",
  "member.approved": "Aprovou um pedido de acesso",
  "member.rejected": "Recusou um pedido de acesso",
  "member.requested": "Pediu acesso ao CRM",
  "member.updated": "Mudou o papel ou o acesso de alguém",
  "member.access_link": "Gerou link de nova senha para alguém",
  "profile.avatar_updated": "Trocou a foto de perfil",
  "profile.avatar_removed": "Tirou a foto de perfil",
  "org.settings": "Mudou as configurações da organização",
  "stage.created": "Criou uma etapa de funil",
  "stage.updated": "Editou uma etapa de funil",
  "stage.archived": "Arquivou uma etapa de funil",
  "stage.reordered": "Reordenou as etapas de um funil",
  "instance.google_client_saved": "Salvou a credencial do Google",
  "instance.instagram_credentials_saved": "Salvou as credenciais do Instagram",
  "instance.instagram_credentials_cleared": "Apagou as credenciais do Instagram",
};

export function activityLabel(action: string) {
  return LABELS[action] ?? action;
}

type Data = Record<string, unknown> | null | undefined;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const at = (v: unknown) => (str(v) ? `@${str(v)!.replace(/^@/, "")}` : null);

/** Complemento curto da ação ("para Contato", "“Oi, tudo bem?”"…), quando os dados permitem. */
export function activityDetail(action: string, data: Data): string | null {
  if (!data) return null;
  const parts: string[] = [];
  if (action === "board.card_moved" || (action === "opportunity.updated" && str(data.to))) {
    if (action === "opportunity.updated" && str(data.title)) parts.push(str(data.title)!);
    const from = str(data.from);
    const to = str(data.to);
    if (from || to) parts.push(`${from ?? "?"} → ${to ?? "?"}`);
  } else if (action === "cadence.action") {
    const o = str(data.outcome) as CadenceActivityOutcome | null;
    if (o) parts.push(OUTCOME_LABEL[o] ?? o);
    if (str(data.step)) parts.push(`passo “${str(data.step)}”`);
  } else if (action === "board.cleanup") {
    if (typeof data.removed === "number") parts.push(`${data.removed} cartões retirados`);
  } else if (action === "appointment.status" || action === "contact.assigned") {
    // ids não dizem nada para quem lê; o rótulo basta.
  } else {
    const stage = str(data.stage);
    if (stage && action.startsWith("board.")) parts.push(`etapa ${stage}`);
    const title = str(data.title) ?? str(data.name) ?? str(data.label);
    if (title && !["instagram.lead_created", "instagram.lead_forwarded", "instagram.lead_review_kept", "instagram.lead_review_removed"].includes(action)) parts.push(title);
    const to = str(data.to);
    if (action === "instagram.dm_sent" || action.startsWith("instagram.dm_")) {
      if (to) parts.push(`para ${to.startsWith("@") || to.includes(" ") ? to : at(to)}`);
    }
    const author = at(data.author);
    if (author && action.startsWith("instagram.comment")) parts.push(`de ${author}`);
    const preview = str(data.preview);
    if (preview) parts.push(`“${preview.length > 90 ? preview.slice(0, 90) + "…" : preview}”`);
    if (typeof data.count === "number") parts.push(`${data.count} itens`);
    if (typeof data.rows === "number") parts.push(`${data.rows} linhas`);
    if (data.status === "failed") parts.push("(falhou)");
  }
  return parts.length ? parts.join(" · ") : null;
}

/** "iPhone · Safari", "Windows · Chrome"… a partir do user agent (só para leitura humana). */
export function deviceLabel(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  const browser = /Instagram/.test(ua)
    ? "app do Instagram"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /SamsungBrowser/.test(ua)
          ? "Samsung Internet"
          : /CriOS|Chrome\//.test(ua)
            ? "Chrome"
            : /FxiOS|Firefox\//.test(ua)
              ? "Firefox"
              : /Safari\//.test(ua)
                ? "Safari"
                : null;
  const label = [os, browser].filter(Boolean).join(" · ");
  return label || "Outro dispositivo";
}
