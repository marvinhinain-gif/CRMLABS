/**
 * Top Engajados — ações do Instagram e o que a API oficial permite atribuir a uma pessoa.
 * Usado pelo servidor (pontuação) e pela tela (rótulos e configuração). Sem "use client".
 *
 * Integração atual: Instagram API com Login do Instagram, permissões instagram_business_basic,
 * instagram_business_manage_messages e instagram_business_manage_comments, webhooks `messages` e `comments`.
 */

/** Ações com identidade individual (IGSID) entregue pela API: entram no ranking. */
export const TRACKED_KINDS = ["comment", "story_reply", "dm", "story_mention", "dm_share"] as const;
export type EngagementKind = (typeof TRACKED_KINDS)[number];

/** Ações pedidas que a API não entrega por pessoa: nunca entram no score. */
export const UNTRACKED_KINDS = ["repost", "share", "save", "story_view"] as const;
export type UntrackedKind = (typeof UNTRACKED_KINDS)[number];

export type WeightKey = EngagementKind | UntrackedKind;

export const ENGAGEMENT_ACTIONS: Record<WeightKey, { label: string; plural: string; defaultWeight: number; tracked: boolean; how: string }> = {
  comment: { label: "Comentário em publicação", plural: "comentários em publicações", defaultWeight: 5, tracked: true, how: "Webhook de comentários e sincronização das publicações (autor com id oficial)." },
  story_reply: { label: "Resposta a Story", plural: "respostas a Stories", defaultWeight: 8, tracked: true, how: "Chega no Direct com o remetente identificado." },
  dm: { label: "Mensagem no Direct", plural: "mensagens no Direct", defaultWeight: 6, tracked: true, how: "Webhook de mensagens e sincronização do Direct." },
  story_mention: { label: "Menção ao perfil em Story", plural: "menções ao perfil em Stories", defaultWeight: 10, tracked: true, how: "A Meta avisa no Direct quando alguém marca a conta num Story." },
  dm_share: { label: "Compartilhamento recebido no Direct", plural: "publicações compartilhadas no Direct", defaultWeight: 7, tracked: true, how: "Publicação ou Reel enviado para a conta pelo Direct." },
  repost: { label: "Repost", plural: "reposts", defaultWeight: 12, tracked: false, how: "A API não informa quem repostou." },
  share: { label: "Compartilhamento fora do Direct", plural: "compartilhamentos", defaultWeight: 7, tracked: false, how: "A API só informa o total (Insights), sem identificar quem compartilhou." },
  save: { label: "Salvamento", plural: "salvamentos", defaultWeight: 7, tracked: false, how: "A API só informa o total (Insights), sem identificar quem salvou." },
  story_view: { label: "Visualização de Story", plural: "visualizações de Stories", defaultWeight: 1, tracked: false, how: "A API não lista quem visualizou os Stories." },
};

/** Outras limitações documentadas (não viram ação nem métrica individual). */
export const API_LIMITATIONS = [
  "Curtidas: a API informa só o total por publicação, nunca quem curtiu.",
  "Menções ao perfil em publicações ou comentários de outras contas não chegam pela integração atual (exigiria a rota com Login do Facebook).",
  "Reações a Stories com emoji não são entregues como evento separado.",
];

export const DEFAULT_WEIGHTS = Object.fromEntries(Object.entries(ENGAGEMENT_ACTIONS).map(([k, v]) => [k, v.defaultWeight])) as Record<WeightKey, number>;
/** Anti-spam: por pessoa, cada tipo de ação pontua no máximo N vezes por dia. */
export const DEFAULT_DAILY_CAP = 5;

export const PERIODS = ["today", "week", "month"] as const;
export type EngagementPeriod = (typeof PERIODS)[number];

export const KIND_FILTERS = ["all", "comments", "directs", "stories", "mentions", "shares"] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];

export const KIND_FILTER_LABEL: Record<KindFilter, string> = {
  all: "Todas as interações",
  comments: "Comentários",
  directs: "Directs",
  stories: "Stories",
  mentions: "Menções",
  shares: "Compartilhamentos identificáveis",
};

export const KINDS_BY_FILTER: Record<KindFilter, EngagementKind[]> = {
  all: [...TRACKED_KINDS],
  comments: ["comment"],
  directs: ["dm", "dm_share"],
  stories: ["story_reply", "story_mention"],
  mentions: ["story_mention"],
  shares: ["dm_share"],
};

export const CRM_STATUSES = ["none", "lead", "closer", "client"] as const;
export type CrmStatus = (typeof CRM_STATUSES)[number];
export const CRM_STATUS_LABEL: Record<CrmStatus, string> = {
  none: "Não está no CRM",
  lead: "Lead no Social Seller",
  closer: "Encaminhado ao Closer",
  client: "Cliente",
};
