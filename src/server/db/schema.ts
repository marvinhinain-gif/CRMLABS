/**
 * CRMLABS — modelo de dados.
 * Todos os registros de negócio pertencem a uma organização (org_id).
 * Datas em UTC (timestamptz). Valores monetários em centavos (bigint).
 */
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  date,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();
const orgRef = () => uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" });

// ---------- Enums ----------
export const roleEnum = pgEnum("member_role", ["admin", "manager", "seller", "closer"]);
export const membershipStatusEnum = pgEnum("membership_status", ["active", "invited", "disabled", "pending"]);
export const authTokenKindEnum = pgEnum("auth_token_kind", ["reset", "invite"]);
export const accountStatusEnum = pgEnum("account_status", [
  "connected",
  "insufficient_permission",
  "reconnect_required",
  "error",
  "disconnected",
]);
export const contactSourceEnum = pgEnum("contact_source", [
  "manual",
  "instagram_dm",
  "instagram_comment",
  "import",
  "lead_form",
]);
export const leadStatusEnum = pgEnum("lead_status", ["new", "contacted", "scheduled", "no_answer", "disqualified"]);
export const pipelineKindEnum = pgEnum("pipeline_kind", ["relationship", "sales"]);
export const opportunityStatusEnum = pgEnum("opportunity_status", ["open", "won", "lost"]);
export const appointmentStatusEnum = pgEnum("appointment_status", ["scheduled", "done", "canceled", "no_show"]);
export const conversationStatusEnum = pgEnum("conversation_status", ["open", "closed"]);
export const directionEnum = pgEnum("message_direction", ["in", "out"]);
export const messageStatusEnum = pgEnum("message_status", [
  "received",
  "pending",
  "accepted",
  "unconfirmed",
  "failed",
  "delivered",
  "read",
]);
export const commentStatusEnum = pgEnum("comment_status", ["new", "in_progress", "replied", "done", "ignored"]);
export const replyKindEnum = pgEnum("reply_kind", ["public", "private"]);
export const taskStatusEnum = pgEnum("task_status", ["open", "done", "in_progress"]);
export const jobStatusEnum = pgEnum("job_status", ["queued", "running", "done", "failed"]);
export const webhookStatusEnum = pgEnum("webhook_status", ["received", "processed", "failed", "ignored"]);

// ---------- Organização e acesso ----------
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/Bahia"),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Caixa compartilhada: sellers também veem conversas sem responsável. */
  sharedInbox: boolean("shared_inbox").notNull().default(false),
  /** Etapa onde contatos criados por mensagem/comentário entram (null = não criar cartão). */
  autoEntryStageId: uuid("auto_entry_stage_id"),
  /** Criar contato automaticamente ao receber mensagem de um remetente novo. */
  autoCreateFromMessages: boolean("auto_create_from_messages").notNull().default(true),
  /** Criar contato automaticamente ao receber comentário de um autor novo. */
  autoCreateFromComments: boolean("auto_create_from_comments").notNull().default(false),
  /** Permite que pessoas peçam acesso pela tela "Criar conta" (aprovação do administrador). */
  allowSignup: boolean("allow_signup").notNull().default(true),
  /** Mensagens de bom dia (9h) e boa noite (21h) para social sellers e closers. */
  dailyNudges: boolean("daily_nudges").notNull().default(true),
  /** Dias para reter mensagens após desconectar uma conta (null = manter). */
  retentionDaysAfterDisconnect: integer("retention_days_after_disconnect"),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    createdAt: createdAt(),
    lastLoginAt: ts("last_login_at"),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/** Foto de perfil (até 512×512, já reduzida e recodificada). Fica no banco porque o servidor não tem disco persistente. */
export const userAvatars = pgTable("user_avatars", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
  mime: text("mime").notNull(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    orgId: orgRef(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("invited"),
    /** Mensagem enviada por quem pediu acesso pela tela de cadastro. */
    requestNote: text("request_note"),
    /** Preferências de notificação por tipo (ausente = padrão do tipo). */
    notifyPrefs: jsonb("notify_prefs").$type<Record<string, boolean>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_org_user_uq").on(t.orgId, t.userId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: orgRef(),
    remember: boolean("remember").notNull().default(false),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    kind: authTokenKindEnum("kind").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("auth_tokens_hash_uq").on(t.tokenHash)],
);

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    key: text("key").notNull(),
    success: boolean("success").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_key_idx").on(t.key, t.createdAt)],
);

// ---------- Integrações ----------
export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: id(),
    orgId: orgRef(),
    provider: text("provider").notNull().default("instagram"),
    /** Rota OAuth usada. Tokens de rotas diferentes nunca são misturados. */
    authRoute: text("auth_route").notNull().default("instagram_login"),
    /** user_id da conta profissional (é o `entry.id` dos webhooks). */
    externalAccountId: text("external_account_id").notNull(),
    /** id app-scoped retornado por /me. */
    appScopedId: text("app_scoped_id"),
    username: text("username"),
    accountType: text("account_type"),
    status: accountStatusEnum("status").notNull().default("connected"),
    grantedScopes: text("granted_scopes").array().notNull().default(sql`'{}'::text[]`),
    webhooksSubscribed: boolean("webhooks_subscribed").notNull().default(false),
    lastError: text("last_error"),
    tokenExpiresAt: ts("token_expires_at"),
    connectedBy: uuid("connected_by").references(() => users.id, { onDelete: "set null" }),
    connectedAt: ts("connected_at"),
    lastCheckedAt: ts("last_checked_at"),
    disconnectedAt: ts("disconnected_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("connected_accounts_uq").on(t.orgId, t.provider, t.externalAccountId)],
);

/** Segredos ficam separados dos campos públicos e criptografados (AES-256-GCM). */
export const accountSecrets = pgTable("account_secrets", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => connectedAccounts.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  updatedAt: updatedAt(),
});

export const oauthStates = pgTable(
  "oauth_states",
  {
    id: id(),
    stateHash: text("state_hash").notNull(),
    orgId: orgRef(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    /** instagram ou google_calendar */
    purpose: text("purpose").notNull().default("instagram"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("oauth_states_hash_uq").on(t.stateHash)],
);

// ---------- Contatos ----------
export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    orgId: orgRef(),
    name: text("name").notNull(),
    /** @ informado manualmente: não é identidade oficial verificada. */
    username: text("username"),
    profileUrl: text("profile_url"),
    avatarUrl: text("avatar_url"),
    email: text("email"),
    phone: text("phone"),
    source: contactSourceEnum("source").notNull().default("manual"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    summary: text("summary"),
    nextAction: text("next_action"),
    nextActionAt: ts("next_action_at"),
    lastInteractionAt: ts("last_interaction_at"),
    mergedIntoId: uuid("merged_into_id"),
    archivedAt: ts("archived_at"),
    /** Atribuição: primeira e última origem conhecidas (a jornada completa fica em contact_touchpoints). */
    firstSourceId: uuid("first_source_id"),
    firstTouchAt: ts("first_touch_at"),
    lastSourceId: uuid("last_source_id"),
    lastTouchAt: ts("last_touch_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("contacts_org_idx").on(t.orgId, t.createdAt),
    index("contacts_owner_idx").on(t.orgId, t.ownerId),
  ],
);

export const channelIdentities = pgTable(
  "channel_identities",
  {
    id: id(),
    orgId: orgRef(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("instagram"),
    /** Identificador oficial do provedor (IGSID no Instagram). */
    externalId: text("external_id").notNull(),
    username: text("username"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("channel_identities_uq").on(t.orgId, t.accountId, t.externalId)],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    orgId: orgRef(),
    name: text("name").notNull(),
    color: text("color").notNull().default("green"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("tags_org_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

export const contactTags = pgTable(
  "contact_tags",
  {
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contactId, t.tagId] })],
);

/** Notas internas. Nunca são enviadas ao Instagram. */
export const notes = pgTable("notes", {
  id: id(),
  orgId: orgRef(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

// ---------- Funis ----------
export const pipelines = pgTable(
  "pipelines",
  {
    id: id(),
    orgId: orgRef(),
    kind: pipelineKindEnum("kind").notNull(),
    name: text("name").notNull(),
    /** Funil comercial pessoal de um closer (null = funil padrão da organização). */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pipelines_owner_uq").on(t.orgId, t.kind, t.ownerId).where(sql`${t.ownerId} is not null`)],
);

/** Significado de uma etapa comercial para as métricas (o nome é livre). */
export const STAGE_TYPES = ["entry", "contacted", "scheduled", "meeting_done", "follow_up", "negotiation", "won", "lost", "custom"] as const;
export type StageType = (typeof STAGE_TYPES)[number];

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    orgId: orgRef(),
    pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
    /** Identificador estável: não muda ao renomear (usado por métricas). */
    key: text("key").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("green"),
    position: integer("position").notNull(),
    /** Tipo da etapa (Novo lead, Reunião agendada, Venda ganha…): mantém as métricas certas com qualquer nome. */
    stageType: text("stage_type").$type<StageType>().notNull().default("custom"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pipeline_stages_key_uq").on(t.pipelineId, t.key)],
);

export const relationshipEntries = pgTable(
  "relationship_entries",
  {
    id: id(),
    orgId: orgRef(),
    pipelineId: uuid("pipeline_id").notNull().references(() => pipelines.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").notNull().references(() => pipelineStages.id),
    position: integer("position").notNull().default(0),
    version: integer("version").notNull().default(1),
    closedAt: ts("closed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Um contato possui no máximo uma entrada ativa por funil.
    uniqueIndex("relationship_entries_active_uq").on(t.pipelineId, t.contactId).where(sql`${t.closedAt} is null`),
    index("relationship_entries_stage_idx").on(t.stageId),
  ],
);

/** Histórico imutável de movimentação (protegido por trigger no banco). */
export const stageHistory = pgTable(
  "stage_history",
  {
    id: id(),
    orgId: orgRef(),
    entityType: text("entity_type").notNull(), // relationship | opportunity
    entityId: uuid("entity_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    fromStageId: uuid("from_stage_id"),
    toStageId: uuid("to_stage_id"),
    fromStageName: text("from_stage_name"),
    toStageName: text("to_stage_name"),
    actorId: uuid("actor_id"),
    reason: text("reason"),
    createdAt: createdAt(),
  },
  (t) => [
    index("stage_history_contact_idx").on(t.contactId, t.createdAt),
    index("stage_history_to_idx").on(t.orgId, t.toStageId, t.createdAt),
  ],
);

// ---------- Comercial ----------
export const opportunities = pgTable(
  "opportunities",
  {
    id: id(),
    orgId: orgRef(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    product: text("product"),
    valueCents: bigint("value_cents", { mode: "number" }).notNull().default(0),
    currency: text("currency").notNull().default("BRL"),
    closerId: uuid("closer_id").references(() => users.id, { onDelete: "set null" }),
    /** Social seller que qualificou e encaminhou (crédito nas métricas e no ranking). */
    sellerId: uuid("seller_id").references(() => users.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    forwardedAt: ts("forwarded_at"),
    stageId: uuid("stage_id").notNull().references(() => pipelineStages.id),
    status: opportunityStatusEnum("status").notNull().default("open"),
    expectedCloseDate: date("expected_close_date"),
    closedAt: ts("closed_at"),
    lostReason: text("lost_reason"),
    version: integer("version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("opportunities_org_idx").on(t.orgId, t.status, t.closedAt)],
);

export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    orgId: orgRef(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    timezone: text("timezone").notNull().default("America/Bahia"),
    location: text("location"),
    status: appointmentStatusEnum("status").notNull().default("scheduled"),
    notes: text("notes"),
    /** Lead (formulário de anúncio) que originou a reunião. */
    leadId: uuid("lead_id"),
    /** Quem agendou (ranking de agendamentos). */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Evento correspondente na agenda Google do responsável. */
    googleEventId: text("google_event_id"),
    calendarSyncedAt: ts("calendar_synced_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("appointments_org_idx").on(t.orgId, t.startsAt)],
);

// ---------- Conversas ----------
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    orgId: orgRef(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => connectedAccounts.id, { onDelete: "set null" }),
    channel: text("channel").notNull().default("instagram"),
    externalThreadId: text("external_thread_id"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    status: conversationStatusEnum("status").notNull().default("open"),
    lastMessageAt: ts("last_message_at"),
    lastMessageDirection: directionEnum("last_message_direction"),
    lastMessagePreview: text("last_message_preview"),
    lastInboundAt: ts("last_inbound_at"),
    unreadCount: integer("unread_count").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversations_contact_account_uq").on(t.orgId, t.contactId, t.channel),
    index("conversations_org_last_idx").on(t.orgId, t.lastMessageAt),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    orgId: orgRef(),
    conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    direction: directionEnum("direction").notNull(),
    /** mid do provedor; único por conversa/organização para deduplicação. */
    externalId: text("external_id"),
    body: text("body"),
    attachments: jsonb("attachments").$type<{ type: string; url?: string }[]>(),
    status: messageStatusEnum("status").notNull(),
    error: text("error"),
    /** Idempotência por clique: o cliente gera um id por tentativa de envio. */
    clientRequestId: text("client_request_id"),
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    sentAt: ts("sent_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("messages_external_uq").on(t.orgId, t.externalId),
    uniqueIndex("messages_client_req_uq").on(t.orgId, t.clientRequestId),
    index("messages_conversation_idx").on(t.conversationId, t.sentAt),
  ],
);

export const savedReplies = pgTable("saved_replies", {
  id: id(),
  orgId: orgRef(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const socialPosts = pgTable(
  "social_posts",
  {
    id: id(),
    orgId: orgRef(),
    accountId: uuid("account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    caption: text("caption"),
    mediaType: text("media_type"),
    permalink: text("permalink"),
    thumbnailUrl: text("thumbnail_url"),
    postedAt: ts("posted_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("social_posts_uq").on(t.accountId, t.externalId)],
);

export const socialComments = pgTable(
  "social_comments",
  {
    id: id(),
    orgId: orgRef(),
    accountId: uuid("account_id").notNull().references(() => connectedAccounts.id, { onDelete: "cascade" }),
    postId: uuid("post_id").references(() => socialPosts.id, { onDelete: "set null" }),
    externalId: text("external_id").notNull(),
    parentExternalId: text("parent_external_id"),
    authorExternalId: text("author_external_id"),
    authorUsername: text("author_username"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    text: text("text"),
    commentedAt: ts("commented_at").notNull(),
    status: commentStatusEnum("status").notNull().default("new"),
    privateReplySentAt: ts("private_reply_sent_at"),
    isOwn: boolean("is_own").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("social_comments_uq").on(t.accountId, t.externalId),
    index("social_comments_org_idx").on(t.orgId, t.commentedAt),
  ],
);

export const commentReplies = pgTable(
  "comment_replies",
  {
    id: id(),
    orgId: orgRef(),
    commentId: uuid("comment_id").notNull().references(() => socialComments.id, { onDelete: "cascade" }),
    kind: replyKindEnum("kind").notNull(),
    body: text("body").notNull(),
    status: messageStatusEnum("status").notNull(),
    externalId: text("external_id"),
    error: text("error"),
    clientRequestId: text("client_request_id").notNull(),
    sentBy: uuid("sent_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("comment_replies_client_req_uq").on(t.orgId, t.clientRequestId),
    // Resposta privada: no máximo uma ativa por comentário (regra oficial).
    uniqueIndex("comment_replies_private_uq")
      .on(t.commentId)
      .where(sql`${t.kind} = 'private' and ${t.status} <> 'failed'`),
  ],
);

// ---------- Tarefas ----------
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    orgId: orgRef(),
    title: text("title").notNull(),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    dueAt: ts("due_at"),
    status: taskStatusEnum("status").notNull().default("open"),
    /** low | medium | high */
    priority: text("priority").$type<"low" | "medium" | "high">().notNull().default("medium"),
    /** Descrição da tarefa. */
    notes: text("notes"),
    completedAt: ts("completed_at"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_org_owner_idx").on(t.orgId, t.ownerId, t.status, t.dueAt), index("tasks_contact_idx").on(t.contactId)],
);

export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: id(),
    orgId: orgRef(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: boolean("done").notNull().default(false),
    position: integer("position").notNull().default(0),
    doneAt: ts("done_at"),
    createdAt: createdAt(),
  },
  (t) => [index("task_checklist_task_idx").on(t.taskId, t.position)],
);

/** Materiais da tarefa: proposta, gravação, documentos (links). */
export const taskLinks = pgTable(
  "task_links",
  {
    id: id(),
    orgId: orgRef(),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    url: text("url").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("task_links_task_idx").on(t.taskId, t.position)],
);

// ---------- Operação ----------
export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    orgId: orgRef(),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_org_idx").on(t.orgId, t.createdAt)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    orgId: orgRef(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    readAt: ts("read_at"),
    /** Quando o envio para o celular foi processado (null = pendente). */
    pushedAt: ts("pushed_at"),
    /** Evita duplicidade (ex.: "daily:morning:2026-10-05", "task:<id>:overdue"). */
    dedupeKey: text("dedupe_key"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_uq").on(t.userId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt),
    index("notifications_push_pending_idx").on(t.createdAt).where(sql`${t.pushedAt} is null`),
  ],
);

/** Aparelhos inscritos para receber notificações (Web Push). */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSuccessAt: ts("last_success_at"),
    failures: integer("failures").notNull().default(0),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId)],
);

/** Configurações da instalação (ex.: credenciais do app da Meta, chaves do Web Push). Segredos ficam criptografados. */
export const instanceSettings = pgTable("instance_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: updatedAt(),
});

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    /** Chave de deduplicação: conta + identificador do evento/mensagem. */
    eventKey: text("event_key").notNull(),
    accountExternalId: text("account_external_id"),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    field: text("field"),
    payload: jsonb("payload").notNull(),
    status: webhookStatusEnum("status").notNull().default("received"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    lastError: text("last_error"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("webhook_events_key_uq").on(t.provider, t.eventKey),
    index("webhook_events_pending_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const integrationJobs = pgTable(
  "integration_jobs",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key"),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    runAfter: ts("run_after").notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("integration_jobs_dedupe_uq").on(t.dedupeKey),
    index("integration_jobs_pending_idx").on(t.status, t.runAfter),
  ],
);

export type Role = (typeof roleEnum.enumValues)[number];

// ---------- Leads de anúncios ----------
/** Destino de um campo recebido: campo padrão, campo personalizado (custom:<id>), só resposta, ou ignorar. */
export type FieldMapping = { key: string; target: "name" | "phone" | "email" | "instagram" | "product" | "answer" | "ignore" | `custom:${string}` };

export type LeadQuestion = {
  id: string;
  label: string;
  type: "text" | "textarea" | "choice" | "number";
  required: boolean;
  options?: string[];
};

/** Formulário de captação (página pública para o anúncio e/ou recebimento por webhook). */
export const leadForms = pgTable(
  "lead_forms",
  {
    id: id(),
    orgId: orgRef(),
    name: text("name").notNull(),
    /** Endereço público: /f/{slug} */
    slug: text("slug").notNull(),
    headline: text("headline").notNull(),
    description: text("description"),
    questions: jsonb("questions").$type<LeadQuestion[]>().notNull().default([]),
    askEmail: boolean("ask_email").notNull().default(true),
    askInstagram: boolean("ask_instagram").notNull().default(true),
    /** Pergunta o melhor dia e horário para a reunião. */
    askPreferredTime: boolean("ask_preferred_time").notNull().default(true),
    thankYou: text("thank_you"),
    /** Social sellers que recebem os leads em rodízio (vazio = todos os sellers ativos). */
    assigneeIds: jsonb("assignee_ids").$type<string[]>().notNull().default([]),
    rotation: integer("rotation").notNull().default(0),
    /** Etapa do Social Seller onde o contato entra (null = não cria cartão). */
    stageId: uuid("stage_id"),
    active: boolean("active").notNull().default(true),
    /** Token do webhook: hash para busca e cópia criptografada para o administrador ver de novo. */
    tokenHash: text("token_hash").notNull(),
    tokenEnc: text("token_enc").notNull(),
    // ----- Integração (conector, atribuição, destino, mapeamento) -----
    /** crmlabs_form · webhook · typeform · tally · google_forms · api */
    provider: text("provider").notNull().default("crmlabs_form"),
    sourceId: uuid("source_id"),
    campaign: text("campaign"),
    channel: text("channel"),
    partner: text("partner"),
    adName: text("ad_name"),
    productId: uuid("product_id"),
    /** relationship (Social Seller) ou sales (Comercial). */
    pipelineKind: text("pipeline_kind").notNull().default("relationship"),
    salesStageId: uuid("sales_stage_id"),
    /** round_robin ou fixed. Regras futuras em assignRules. */
    assignMode: text("assign_mode").notNull().default("round_robin"),
    fixedAssigneeId: uuid("fixed_assignee_id"),
    assignRules: jsonb("assign_rules").$type<Record<string, unknown>>().notNull().default({}),
    /** Campo recebido → campo do CRM. */
    fieldMap: jsonb("field_map").$type<FieldMapping[]>().notNull().default([]),
    /** Segredo de assinatura (Typeform, Tally, HMAC próprio), criptografado. */
    signingSecretEnc: text("signing_secret_enc"),
    /** Último envio recebido (rótulo → valor), para ajudar no mapeamento. Só administradores veem. */
    lastSample: jsonb("last_sample").$type<{ key: string; value: string }[]>(),
    lastLeadAt: ts("last_lead_at"),
    lastErrorAt: ts("last_error_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("lead_forms_slug_uq").on(t.slug), uniqueIndex("lead_forms_token_uq").on(t.tokenHash), index("lead_forms_org_idx").on(t.orgId)],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    orgId: orgRef(),
    formId: uuid("form_id").references(() => leadForms.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    status: leadStatusEnum("status").notNull().default("new"),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    instagram: text("instagram"),
    /** Respostas exatamente como enviadas (cópia, para não depender de mudanças no formulário). */
    answers: jsonb("answers").$type<{ label: string; value: string }[]>().notNull().default([]),
    preferredAt: ts("preferred_at"),
    preferredText: text("preferred_text"),
    /** Origem do anúncio: utm_source, utm_campaign, utm_content, fbclid… */
    utm: jsonb("utm").$type<Record<string, string>>().notNull().default({}),
    channel: text("channel").notNull().default("form"),
    sourceId: uuid("source_id"),
    campaign: text("campaign"),
    adChannel: text("ad_channel"),
    partner: text("partner"),
    adName: text("ad_name"),
    productId: uuid("product_id"),
    /** Valores dos campos personalizados: { [customFieldId]: valor } */
    custom: jsonb("custom").$type<Record<string, string>>().notNull().default({}),
    opportunityId: uuid("opportunity_id"),
    appointmentId: uuid("appointment_id"),
    contactedAt: ts("contacted_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("leads_org_idx").on(t.orgId, t.createdAt), index("leads_assigned_idx").on(t.orgId, t.assignedTo, t.status)],
);

// ---------- Origens, produtos, campos personalizados e jornada ----------
export const leadSources = pgTable(
  "lead_sources",
  {
    id: id(),
    orgId: orgRef(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull().default("gray"),
    position: integer("position").notNull().default(0),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("lead_sources_org_key_uq").on(t.orgId, t.key)],
);

export const products = pgTable(
  "products",
  {
    id: id(),
    orgId: orgRef(),
    name: text("name").notNull(),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("products_org_name_uq").on(t.orgId, sql`lower(${t.name})`)],
);

export const customFields = pgTable(
  "custom_fields",
  {
    id: id(),
    orgId: orgRef(),
    key: text("key").notNull(),
    label: text("label").notNull(),
    /** Aparece na ficha de preparação do closer. */
    showToCloser: boolean("show_to_closer").notNull().default(true),
    position: integer("position").notNull().default(0),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("custom_fields_org_key_uq").on(t.orgId, t.key)],
);

/** Pontos de contato: cada vez que a pessoa chega por uma origem (formulário, registro manual…). */
export const contactTouchpoints = pgTable(
  "contact_touchpoints",
  {
    id: id(),
    orgId: orgRef(),
    contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id"),
    kind: text("kind").notNull().default("form"),
    campaign: text("campaign"),
    channel: text("channel"),
    partner: text("partner"),
    adName: text("ad_name"),
    integrationId: uuid("integration_id"),
    integrationName: text("integration_name"),
    leadId: uuid("lead_id"),
    utm: jsonb("utm").$type<Record<string, string>>().notNull().default({}),
    note: text("note"),
    actorId: uuid("actor_id"),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
  },
  (t) => [index("contact_touchpoints_contact_idx").on(t.contactId, t.occurredAt), index("contact_touchpoints_org_idx").on(t.orgId, t.occurredAt)],
);

export const integrationLogs = pgTable(
  "integration_logs",
  {
    id: id(),
    orgId: orgRef(),
    integrationId: uuid("integration_id"),
    integrationName: text("integration_name"),
    event: text("event").notNull(),
    result: text("result").notNull(),
    message: text("message"),
    leadId: uuid("lead_id"),
    detected: jsonb("detected").$type<Record<string, boolean>>(),
    createdAt: createdAt(),
  },
  (t) => [index("integration_logs_org_idx").on(t.orgId, t.createdAt), index("integration_logs_integration_idx").on(t.integrationId, t.createdAt)],
);

// ---------- Agenda pessoal (closer, social seller) ----------
/** Conexão da agenda de cada pessoa: link de assinatura (ICS) e, opcionalmente, Google Agenda. */
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: orgRef(),
    feedTokenHash: text("feed_token_hash").notNull(),
    feedTokenEnc: text("feed_token_enc").notNull(),
    googleEmail: text("google_email"),
    googleRefreshEnc: text("google_refresh_enc"),
    googleCalendarId: text("google_calendar_id").notNull().default("primary"),
    /** Cria link do Google Meet quando a reunião não tem local. */
    createMeet: boolean("create_meet").notNull().default(true),
    googleConnectedAt: ts("google_connected_at"),
    lastSyncAt: ts("last_sync_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("calendar_connections_feed_uq").on(t.feedTokenHash)],
);

// ---------- Métricas comerciais ----------
export const SALES_EVENT_TYPES = ["contact_made", "meeting_scheduled", "meeting_done", "meeting_no_show", "meeting_canceled", "lead_forwarded", "sale_won", "sale_lost", "stage_moved"] as const;
export type SalesEventType = (typeof SALES_EVENT_TYPES)[number];

/**
 * Eventos comerciais (somente inclusão). As métricas do Dashboard vêm daqui, não do estado atual do lead.
 * Desfazer (reabrir venda, reunião que deixou de ser "realizada") marca o evento como anulado, sem apagar.
 * As dimensões (origem, campanha, produto, social seller, closer) são gravadas no momento do evento.
 */
export const salesEvents = pgTable(
  "sales_events",
  {
    id: id(),
    orgId: orgRef(),
    type: text("type").$type<SalesEventType>().notNull(),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    actorId: uuid("actor_id"),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id"),
    appointmentId: uuid("appointment_id"),
    sellerId: uuid("seller_id"),
    closerId: uuid("closer_id"),
    sourceId: uuid("source_id"),
    campaign: text("campaign"),
    productId: uuid("product_id"),
    valueCents: bigint("value_cents", { mode: "number" }).notNull().default(0),
    fromStageType: text("from_stage_type"),
    toStageType: text("to_stage_type"),
    /** Chave de idempotência (ex.: contato por dia, reunião, venda por versão). */
    dedupeKey: text("dedupe_key"),
    voidedAt: ts("voided_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sales_events_dedupe_uq").on(t.orgId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    index("sales_events_org_type_idx").on(t.orgId, t.type, t.occurredAt),
    index("sales_events_contact_idx").on(t.contactId, t.occurredAt),
  ],
);

/** Meta de faturamento por mês ("2026-10"). */
export const salesGoals = pgTable(
  "sales_goals",
  {
    id: id(),
    orgId: orgRef(),
    month: text("month").notNull(),
    targetCents: bigint("target_cents", { mode: "number" }).notNull(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("sales_goals_org_month_uq").on(t.orgId, t.month)],
);
