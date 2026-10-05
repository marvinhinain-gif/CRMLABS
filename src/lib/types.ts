export type Role = "admin" | "manager" | "seller" | "closer";

export type Me = {
  user: { id: string; name: string; email: string; role: Role; avatarUrl: string | null };
  org: { id: string; name: string; isDemo: boolean; sharedInbox: boolean; timezone: string; autoEntryStageId: string | null };
  orgs: { id: string; name: string; isDemo: boolean; role: Role }[];
  counts: { unreadConversations: number; newLeads: number };
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
  };
};

export type Member = { userId: string; name: string; email?: string; role: Role; status: "active" | "invited" | "disabled" | "pending"; lastLoginAt?: string | null; requestNote?: string | null; requestedAt?: string; avatarUrl?: string | null };

export type Stage = { id: string; key: string; name: string; color: string; position: number; archivedAt: string | null };

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
  tags: { id: string; name: string; color: string }[];
};

export type Board = { stages: (Stage & { total: number; cards: BoardCard[] })[]; pageSize: number };

export const ROLE_LABEL: Record<Role, string> = { admin: "Administrador", manager: "Gestor", seller: "Social seller", closer: "Closer" };
