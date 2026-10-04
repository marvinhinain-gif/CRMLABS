import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "../../db";
import { accountSecrets, connectedAccounts } from "../../db/schema";
import { decryptSecret } from "../../crypto";
import { instagramConfig } from "../../env";
import { ProviderError } from "./client";
import { logger } from "../../logger";
import { publish } from "../../realtime";

export type Account = typeof connectedAccounts.$inferSelect;

export const REQUIRED_SCOPES = {
  basic: "instagram_business_basic",
  messages: "instagram_business_manage_messages",
  comments: "instagram_business_manage_comments",
} as const;

/**
 * Contrato de capacidades por conexão: a interface só mostra ações que a conta pode executar.
 * Derivado do status real e das permissões efetivamente concedidas no OAuth.
 */
export function capabilitiesOf(account: Pick<Account, "status" | "grantedScopes" | "webhooksSubscribed"> | null | undefined) {
  const connected = account?.status === "connected";
  const has = (s: string) => !!account?.grantedScopes.includes(s);
  const basic = has(REQUIRED_SCOPES.basic);
  return {
    connected,
    receiveMessages: connected && basic && has(REQUIRED_SCOPES.messages) && !!account?.webhooksSubscribed,
    sendMessages: connected && basic && has(REQUIRED_SCOPES.messages),
    readComments: connected && basic && has(REQUIRED_SCOPES.comments),
    replyComments: connected && basic && has(REQUIRED_SCOPES.comments),
    privateReplies: connected && basic && has(REQUIRED_SCOPES.comments) && has(REQUIRED_SCOPES.messages),
    humanAgentTag: connected && instagramConfig().humanAgentEnabled,
    attachments: false, // exige armazenamento de arquivos com URL pública: fora do MVP
    // Explicitamente fora do escopo oficial validado (ver README):
    browseThirdPartyStories: false,
  };
}
export type Capabilities = ReturnType<typeof capabilitiesOf>;

export const STATUS_LABEL: Record<Account["status"], string> = {
  connected: "Conectado",
  insufficient_permission: "Permissão insuficiente",
  reconnect_required: "Reconexão necessária",
  error: "Erro",
  disconnected: "Desconectado",
};

export async function getActiveAccount(orgId: string) {
  const [a] = await db
    .select()
    .from(connectedAccounts)
    .where(and(eq(connectedAccounts.orgId, orgId), eq(connectedAccounts.provider, "instagram"), ne(connectedAccounts.status, "disconnected")))
    .orderBy(desc(connectedAccounts.connectedAt))
    .limit(1);
  return a ?? null;
}

export async function getAccountToken(accountId: string): Promise<string> {
  const [s] = await db.select().from(accountSecrets).where(eq(accountSecrets.accountId, accountId));
  if (!s) throw new ProviderError("auth", "Credencial da conta não encontrada. Reconecte o Instagram.");
  return decryptSecret(s.accessTokenEnc);
}

/** Atualiza o status da conta a partir de um erro do provedor (sem registrar o token). */
export async function recordProviderError(account: Account, err: unknown) {
  if (!(err instanceof ProviderError)) return;
  let status: Account["status"] | null = null;
  if (err.kind === "auth") status = "reconnect_required";
  if (err.kind === "permission") status = "insufficient_permission";
  if (!status) return;
  await db
    .update(connectedAccounts)
    .set({ status, lastError: err.message.slice(0, 300), lastCheckedAt: new Date() })
    .where(eq(connectedAccounts.id, account.id));
  logger.warn(`Conta Instagram ${account.id} mudou para ${status}`, { code: err.code });
  await publish({ orgId: account.orgId, topic: "settings", managersOnly: true });
}
