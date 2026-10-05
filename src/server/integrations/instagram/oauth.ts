import { and, eq, gt, isNull, lt, ne } from "drizzle-orm";
import { db } from "../../db";
import { accountSecrets, connectedAccounts, oauthStates } from "../../db/schema";
import type { Ctx } from "../../context";
import { assertCan } from "../../permissions";
import { AppError } from "../../errors";
import { encryptSecret, randomToken, safeEqual, sha256 } from "../../crypto";
import { instagramConfig } from "../../env";
import { audit } from "../../services/common";
import { publish } from "../../realtime";
import { logger } from "../../logger";
import { getInstagramApi, ProviderError } from "./client";
import { capabilitiesOf, getAccountToken, REQUIRED_SCOPES, type Account } from "./accounts";
import { createHmac } from "node:crypto";
import { loadInstanceSettings } from "../../services/instance";

const SCOPES = [REQUIRED_SCOPES.basic, REQUIRED_SCOPES.messages, REQUIRED_SCOPES.comments];
const WEBHOOK_FIELDS = ["messages", "comments"];

export function assertInstagramConfigured() {
  const cfg = instagramConfig();
  if (cfg.missing.length) {
    throw new AppError("channel_unavailable", `Integração ainda não configurada no servidor. Falta: ${cfg.missing.join(", ")}.`, { missing: cfg.missing });
  }
  return cfg;
}

/** Passo 1: somente administrador inicia. Retorna a URL de autorização oficial. */
export async function startConnect(ctx: Ctx) {
  await loadInstanceSettings();
  assertCan(ctx, "integrations.manage", "Somente administradores conectam contas.");
  if (ctx.org.isDemo) throw new AppError("forbidden", "Organizações de demonstração não conectam contas reais.");
  const cfg = assertInstagramConfigured();
  const state = randomToken(24);
  await db.insert(oauthStates).values({
    stateHash: sha256(state),
    orgId: ctx.orgId,
    userId: ctx.userId,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  const q = new URLSearchParams({
    client_id: cfg.appId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES.join(","),
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${q}`;
}

/** Passos 2–5: callback validado por state + vínculo com organização e administrador. */
export async function handleCallback(params: { code?: string | null; state?: string | null; error?: string | null }, sessionCtx: Ctx | null) {
  await loadInstanceSettings();
  if (!params.state) throw new AppError("invalid", "Retorno do Instagram sem parâmetro state.");
  const [st] = await db
    .update(oauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthStates.stateHash, sha256(params.state)), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, new Date())))
    .returning();
  if (!st) throw new AppError("invalid", "Pedido de conexão expirado ou inválido. Tente conectar novamente.");
  if (!sessionCtx || sessionCtx.userId !== st.userId || sessionCtx.orgId !== st.orgId) {
    throw new AppError("forbidden", "Conclua a conexão na mesma sessão de administrador que a iniciou.");
  }
  assertCan(sessionCtx, "integrations.manage");
  if (params.error) throw new AppError("invalid", "A autorização foi cancelada no Instagram.");
  if (!params.code) throw new AppError("invalid", "Retorno do Instagram sem código de autorização.");

  const api = getInstagramApi();
  const short = await api.exchangeCode(params.code.replace(/#_$/, ""));
  const long = await api.longLivedToken(short.accessToken);
  const me = await api.getMe(long.accessToken);
  const granted = short.permissions;
  const missing = SCOPES.filter((s) => !granted.includes(s));

  const values = {
    orgId: st.orgId,
    provider: "instagram",
    authRoute: "instagram_login",
    externalAccountId: me.userId,
    appScopedId: me.id,
    username: me.username,
    accountType: me.accountType ?? null,
    grantedScopes: granted,
    // "Conectado" só é definido por testConnection, após confirmação real no provedor.
    status: (missing.length ? "insufficient_permission" : "error") as Account["status"],
    lastError: missing.length ? `Permissões não concedidas: ${missing.join(", ")}` : "Conexão em verificação.",
    tokenExpiresAt: long.expiresIn ? new Date(Date.now() + long.expiresIn * 1000) : null,
    connectedBy: st.userId,
    connectedAt: new Date(),
    lastCheckedAt: new Date(),
    disconnectedAt: null,
    webhooksSubscribed: false,
  };
  const account = await db.transaction(async (tx) => {
    const [acc] = await tx
      .insert(connectedAccounts)
      .values(values)
      .onConflictDoUpdate({ target: [connectedAccounts.orgId, connectedAccounts.provider, connectedAccounts.externalAccountId], set: values })
      .returning();
    await tx
      .insert(accountSecrets)
      .values({ accountId: acc.id, accessTokenEnc: encryptSecret(long.accessToken) })
      .onConflictDoUpdate({ target: accountSecrets.accountId, set: { accessTokenEnc: encryptSecret(long.accessToken), updatedAt: new Date() } });
    await audit(tx, sessionCtx, "integration.connected", "connected_account", acc.id, { username: me.username, scopes: granted });
    return acc;
  });

  // Passo 4: inscreve eventos suportados e testa a conexão. "Conectado" só após confirmação.
  try {
    await api.subscribeWebhooks(long.accessToken, WEBHOOK_FIELDS);
    await db.update(connectedAccounts).set({ webhooksSubscribed: true }).where(eq(connectedAccounts.id, account.id));
  } catch (e) {
    const msg = e instanceof ProviderError ? e.message : "Falha ao inscrever webhooks";
    await db.update(connectedAccounts).set({ status: "error", lastError: `Webhooks: ${msg}`.slice(0, 300) }).where(eq(connectedAccounts.id, account.id));
  }
  await publish({ orgId: st.orgId, topic: "settings", managersOnly: true });
  return testConnection(sessionCtx, account.id);
}

/** Testa a credencial chamando /me no provedor e atualiza o status com o resultado real. */
export async function testConnection(ctx: Ctx, accountId: string) {
  await loadInstanceSettings();
  assertCan(ctx, "integrations.manage");
  const [acc] = await db.select().from(connectedAccounts).where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.orgId, ctx.orgId)));
  if (!acc) throw new AppError("not_found", "Conta não encontrada.");
  if (acc.status === "disconnected") return acc;
  try {
    const token = await getAccountToken(acc.id);
    const me = await getInstagramApi().getMe(token);
    if (!acc.webhooksSubscribed && me.userId === acc.externalAccountId) {
      try {
        await getInstagramApi().subscribeWebhooks(token, WEBHOOK_FIELDS);
        await db.update(connectedAccounts).set({ webhooksSubscribed: true }).where(eq(connectedAccounts.id, acc.id));
        acc.webhooksSubscribed = true;
      } catch (e) {
        acc.lastError = `Webhooks: ${(e as Error).message}`.slice(0, 300);
      }
    }
    const missing = SCOPES.filter((s) => !acc.grantedScopes.includes(s));
    const status: Account["status"] = me.userId !== acc.externalAccountId ? "error" : missing.length ? "insufficient_permission" : acc.webhooksSubscribed ? "connected" : "error";
    const lastError =
      status === "error" && me.userId !== acc.externalAccountId
        ? "A credencial pertence a outra conta."
        : status === "error"
          ? (acc.lastError?.startsWith("Webhooks:") ? acc.lastError : "Webhooks não inscritos. Confira o produto Webhooks no app da Meta e teste novamente.")
          : missing.length
            ? `Permissões não concedidas: ${missing.join(", ")}`
            : null;
    const [u] = await db
      .update(connectedAccounts)
      .set({ status, lastError, username: me.username, lastCheckedAt: new Date() })
      .where(eq(connectedAccounts.id, acc.id))
      .returning();
    return u;
  } catch (e) {
    const kind = e instanceof ProviderError ? e.kind : "server";
    const status: Account["status"] = kind === "auth" ? "reconnect_required" : kind === "permission" ? "insufficient_permission" : "error";
    const [u] = await db
      .update(connectedAccounts)
      .set({ status, lastError: (e as Error).message.slice(0, 300), lastCheckedAt: new Date() })
      .where(eq(connectedAccounts.id, acc.id))
      .returning();
    return u;
  } finally {
    await publish({ orgId: ctx.orgId, topic: "settings", managersOnly: true });
  }
}

/** Passo 6: desconexão impede novos envios e eventos daquele vínculo. Dados seguem a política de retenção. */
export async function disconnectAccount(ctx: Ctx, accountId: string) {
  assertCan(ctx, "integrations.manage", "Somente administradores desconectam contas.");
  const [acc] = await db.select().from(connectedAccounts).where(and(eq(connectedAccounts.id, accountId), eq(connectedAccounts.orgId, ctx.orgId)));
  if (!acc) throw new AppError("not_found", "Conta não encontrada.");
  try {
    await getInstagramApi().unsubscribeWebhooks(await getAccountToken(acc.id));
  } catch (e) {
    logger.warn("Não foi possível cancelar webhooks no provedor (seguindo com a desconexão local)", e);
  }
  await db.transaction(async (tx) => {
    await tx.delete(accountSecrets).where(eq(accountSecrets.accountId, acc.id));
    await tx
      .update(connectedAccounts)
      .set({ status: "disconnected", webhooksSubscribed: false, disconnectedAt: new Date(), lastError: null })
      .where(eq(connectedAccounts.id, acc.id));
    await audit(tx, ctx, "integration.disconnected", "connected_account", acc.id, { username: acc.username });
  });
  await publish({ orgId: ctx.orgId, topic: "settings", managersOnly: true });
}

export function publicAccount(acc: Account) {
  // Nunca inclui segredos: eles ficam em account_secrets.
  return {
    id: acc.id,
    provider: acc.provider,
    authRoute: acc.authRoute,
    username: acc.username,
    accountType: acc.accountType,
    status: acc.status,
    grantedScopes: acc.grantedScopes,
    webhooksSubscribed: acc.webhooksSubscribed,
    lastError: acc.lastError,
    tokenExpiresAt: acc.tokenExpiresAt,
    connectedAt: acc.connectedAt,
    lastCheckedAt: acc.lastCheckedAt,
    capabilities: capabilitiesOf(acc),
  };
}

/** Renova tokens longos com menos de 10 dias de validade (token precisa ter ao menos 24 h). */
export async function refreshExpiringTokens() {
  await loadInstanceSettings();
  const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
  const accounts = await db
    .select()
    .from(connectedAccounts)
    .where(and(ne(connectedAccounts.status, "disconnected"), lt(connectedAccounts.tokenExpiresAt, soon)));
  for (const acc of accounts) {
    try {
      const r = await getInstagramApi().refreshToken(await getAccountToken(acc.id));
      await db.update(accountSecrets).set({ accessTokenEnc: encryptSecret(r.accessToken), updatedAt: new Date() }).where(eq(accountSecrets.accountId, acc.id));
      await db
        .update(connectedAccounts)
        .set({ tokenExpiresAt: r.expiresIn ? new Date(Date.now() + r.expiresIn * 1000) : acc.tokenExpiresAt })
        .where(eq(connectedAccounts.id, acc.id));
    } catch (e) {
      if (e instanceof ProviderError && e.kind === "auth") {
        await db.update(connectedAccounts).set({ status: "reconnect_required", lastError: "Token expirado. Reconecte o Instagram." }).where(eq(connectedAccounts.id, acc.id));
      }
      logger.warn(`Falha ao renovar token da conta ${acc.id}`, e);
    }
  }
}

/** Valida `signed_request` da Meta (callbacks de desautorização e exclusão de dados). */
export function parseSignedRequest(signed: string): { user_id?: string } | null {
  const secret = instagramConfig().appSecret;
  if (!secret || !signed.includes(".")) return null;
  const [sig, payload] = signed.split(".", 2);
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!safeEqual(sig.replace(/=+$/, ""), expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Usuário revogou o app no Instagram: marca as contas como desconectadas e apaga credenciais. */
export async function handleDeauthorize(externalUserId: string) {
  const accounts = await db.select().from(connectedAccounts).where(eq(connectedAccounts.externalAccountId, externalUserId));
  for (const acc of accounts) {
    await db.delete(accountSecrets).where(eq(accountSecrets.accountId, acc.id));
    await db
      .update(connectedAccounts)
      .set({ status: "disconnected", webhooksSubscribed: false, disconnectedAt: new Date(), lastError: "Acesso revogado no Instagram." })
      .where(eq(connectedAccounts.id, acc.id));
    await audit(db, { orgId: acc.orgId, userId: null }, "integration.revoked", "connected_account", acc.id);
    await publish({ orgId: acc.orgId, topic: "settings", managersOnly: true });
  }
  return accounts.length;
}

