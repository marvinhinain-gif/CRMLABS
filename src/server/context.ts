import type { Role } from "./db/schema";

export type Ctx = {
  userId: string;
  userName: string;
  userEmail: string;
  orgId: string;
  role: Role;
  /** Administrador/gestor que também atua como closer (fecha vendas, tem o próprio Kanban comercial). */
  alsoCloser?: boolean;
  sessionId: string;
  org: {
    name: string;
    isDemo: boolean;
    sharedInbox: boolean;
    timezone: string;
    autoEntryStageId: string | null;
  };
};
