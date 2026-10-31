import type { CadenceChannel, CadenceStatus } from "./cadence";

export type Role = "admin" | "manager" | "seller" | "closer";

export type Me = {
  user: { id: string; name: string; email: string; role: Role; avatarUrl: string | null };
  org: { id: string; name: string; isDemo: boolean; sharedInbox: boolean; timezone: string; autoEntryStageId: string | null };
  orgs: { id: string; name: string; isDemo: boolean; role: Role }[];
  counts: { unreadConversations: number; newLeads: number; pendingDirects: number; pendingComments: number };
  permissions: {
    dataAll: boolean;
    teamManage: boolean;
    integrations: boolean;
    orgSettings: boolean;
    pipelineEdit: boolean;
    assign: boolean;
    import: boolean;
    merge: boolean;
    savedReplies: boolean;
    decide: boolean;
    forms: boolean;
    engagement: boolean;
  };
};

export type Member = { userId: string; name: string; email?: string; role: Role; status: "active" | "invited" | "disabled" | "pending"; lastLoginAt?: string | null; requestNote?: string | null; requestedAt?: string; avatarUrl?: string | null };

export type Stage = { id: string; key: string; name: string; color: string; position: number; archivedAt: string | null; stageType?: string };

export type BoardCard = {
  entryId: string;
  stageId: string;
  version: number;
  contactId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  summary: string | null;
  nextAction: string | null;
  nextActionAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  unread: number;
  hasOfficialIdentity: boolean;
  /** Cadência: situação (null = fora da cadência), nome/canal da etapa atual e prazo. */
  cadenceStatus: CadenceStatus | null;
  cadenceStepName: string | null;
  cadenceStepChannel: CadenceChannel | null;
  cadenceDueAt: string | null;
  /** Entrou sozinho pela regra antiga (aguarda revisão do administrador). */
  autoCreated?: boolean;
  tags: { id: string; name: string; color: string }[];
};

/** Um Kanban por SDR (GET /api/board/sdrs): o funil é o mesmo, filtrado pelo responsável do contato. */
export type SdrBoard = { userId: string; name: string; role: Exclude<Role, "closer">; avatarUrl: string | null; total: number };

/** Resposta de POST /api/leads/{id}/kanban. */
export type ForwardToKanbanResult = { entryId: string; stageId: string; stageName: string; sdrId: string; sdrName: string };

/** Valor da URL (?responsavel=todos) para ver o Kanban de toda a equipe (vazio = o meu). */
export const ALL_SDRS = "todos";

export type Board = { stages: (Stage & { total: number; cards: BoardCard[] })[]; pageSize: number };

export const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", manager: "Gestor", seller: "Social seller", closer: "Closer" };

// ---------- Cadência (respostas da API) ----------

export type CadenceStep = { id: string; key: string; name: string; channel: CadenceChannel; waitDays: number; script: string; position: number; archivedAt: string | null };

export type CadenceActivity = { id: string; outcome: string; note: string | null; stepName: string | null; actorName: string | null; createdAt: string };

export type ContactCadence = {
  entry: { id: string; status: CadenceStatus | null; stepId: string | null; dueAt: string | null; startedAt: string | null } | null;
  steps: CadenceStep[];
  currentStep: CadenceStep | null;
  activities: CadenceActivity[];
};

export type CadenceQueueView = "due" | "upcoming" | "responded" | "scheduled" | "lost" | "finished" | "all";

export type CadenceQueueItem = {
  entryId: string;
  contactId: string;
  name: string;
  username: string | null;
  avatarUrl: string | null;
  phone: string | null;
  ownerId: string | null;
  ownerName: string | null;
  stageName: string;
  stageColor: string;
  status: CadenceStatus;
  stepId: string | null;
  stepName: string | null;
  stepChannel: CadenceChannel | null;
  stepIndex: number | null;
  stepCount: number;
  dueAt: string | null;
  startedAt: string | null;
  lastActivity: { outcome: string; note: string | null; at: string; actorName: string | null } | null;
};

export type CadenceQueue = {
  items: CadenceQueueItem[];
  counts: { overdue: number; today: number; upcoming: number; responded: number; scheduled: number; lost: number; finished: number };
};

export type BoardCleanupPreview = {
  total: number;
  byStage: { stageId: string; stageName: string; color: string; count: number }[];
  items: {
    entryId: string;
    contactId: string;
    name: string;
    username: string | null;
    avatarUrl: string | null;
    stageName: string;
    ownerName: string | null;
    reason: "sem_responsavel" | "sem_interacao";
  }[];
};
