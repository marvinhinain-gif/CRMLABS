import { asc, and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { instanceSettings, organizations } from "../db/schema";
import type { Ctx } from "../context";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";
import { instanceCache, instagramConfig, instagramSource } from "../env";
import { AppError, forbidden } from "../errors";
import { logger } from "../logger";
import { audit } from "./common";

/** Chaves cujo valor é guardado criptografado. */
const SECRET_KEYS = new Set(["instagram.app_secret", "instagram.verify_token", "push.vapid_private"]);
const TTL_MS = 30_000;

/** Carrega (com cache curto) as configurações salvas no banco. Seguro chamar em toda requisição. */
export async function loadInstanceSettings(force = false) {
  if (!force && Date.now() - instanceCache.loadedAt < TTL_MS) return instanceCache.values;
  const rows = await db.select().from(instanceSettings);
  const next = new Map<string, string>();
  for (const r of rows) {
    try {
      next.set(r.key, SECRET_KEYS.has(r.key) ? decryptSecret(r.value) : r.value);
    } catch (e) {
      logger.error(`Configuração ${r.key} não pôde ser lida (ENCRYPTION_KEY mudou?)`, e);
    }
  }
  instanceCache.values = next;
  instanceCache.loadedAt = Date.now();
  return next;
}

export async function setInstanceSetting(key: string, value: string | null) {
  if (value === null) {
    await db.delete(instanceSettings).where(eq(instanceSettings.key, key));
  } else {
    const stored = SECRET_KEYS.has(key) ? encryptSecret(value) : value;
    await db
      .insert(instanceSettings)
      .values({ key, value: stored })
      .onConflictDoUpdate({ target: instanceSettings.key, set: { value: stored, updatedAt: new Date() } });
  }
  await loadInstanceSettings(true);
}

/** Configuração do Instagram com as credenciais do painel já carregadas. */
export async function instagramConfigFresh() {
  await loadInstanceSettings();
  return instagramConfig();
}

/** A organização principal da instalação (a mais antiga que não é demonstração). */
export async function ownerOrgId() {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.isDemo, false)).orderBy(asc(organizations.createdAt)).limit(1);
  return org?.id ?? null;
}

/** Credenciais do app da Meta valem para a instalação inteira: só o administrador da organização principal altera. */
export async function assertInstanceAdmin(ctx: Ctx) {
  if (ctx.role !== "admin" || ctx.org.isDemo || (await ownerOrgId()) !== ctx.orgId) {
    throw forbidden("Somente o administrador da organização principal configura o app da Meta.");
  }
}

export const instagramCredentialsSchema = z.object({
  appId: z
    .string()
    .trim()
    .regex(/^\d{6,25}$/, "O ID do app do Instagram tem só números (copie em Instagram → Configuração da API)."),
  /** Vazio = manter a chave secreta já salva. */
  appSecret: z
    .string()
    .trim()
    .max(200)
    .refine((v) => v === "" || /^[a-f0-9]{16,64}$/i.test(v), "A chave secreta do app tem letras de a–f e números (32 caracteres)."),
});

/** Estado da configuração para o painel. Nunca devolve a chave secreta. */
export async function instagramSetupState(ctx: Ctx) {
  await loadInstanceSettings();
  const cfg = instagramConfig();
  const canEdit = ctx.role === "admin" && !ctx.org.isDemo && (await ownerOrgId()) === ctx.orgId;
  return {
    canEdit,
    appId: cfg.appId,
    appIdSource: instagramSource("INSTAGRAM_APP_ID", "instagram.app_id"),
    appSecretSet: !!cfg.appSecret,
    appSecretSource: instagramSource("INSTAGRAM_APP_SECRET", "instagram.app_secret"),
    // O token de verificação não é a chave secreta do app: o administrador precisa copiá-lo para a Meta.
    verifyToken: canEdit ? cfg.verifyToken : "",
    encryptionReady: !!process.env.ENCRYPTION_KEY,
  };
}

export async function saveInstagramCredentials(ctx: Ctx, input: z.infer<typeof instagramCredentialsSchema>) {
  await assertInstanceAdmin(ctx);
  if (!process.env.ENCRYPTION_KEY) throw new AppError("invalid", "O servidor está sem ENCRYPTION_KEY: não é possível guardar a chave secreta com segurança.");
  await loadInstanceSettings(true);
  if (process.env.INSTAGRAM_APP_ID || process.env.INSTAGRAM_APP_SECRET) {
    throw new AppError("conflict", "As credenciais estão definidas nas variáveis de ambiente do servidor e não podem ser trocadas pelo painel.");
  }
  if (!input.appSecret && !instanceCache.values.get("instagram.app_secret")) {
    throw new AppError("invalid", "Informe a chave secreta do app.", { fields: { appSecret: "Informe a chave secreta do app." } });
  }
  await setInstanceSetting("instagram.app_id", input.appId);
  if (input.appSecret) await setInstanceSetting("instagram.app_secret", input.appSecret);
  if (!instanceCache.values.get("instagram.verify_token") && !process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) {
    await setInstanceSetting("instagram.verify_token", randomToken(24));
  }
  await audit(db, ctx, "instance.instagram_credentials_saved", "instance", null, { appId: input.appId, secretChanged: !!input.appSecret });
  return instagramSetupState(ctx);
}

export async function clearInstagramCredentials(ctx: Ctx) {
  await assertInstanceAdmin(ctx);
  await db.delete(instanceSettings).where(and(inArray(instanceSettings.key, ["instagram.app_id", "instagram.app_secret"])));
  await loadInstanceSettings(true);
  await audit(db, ctx, "instance.instagram_credentials_cleared", "instance", null);
  return instagramSetupState(ctx);
}
