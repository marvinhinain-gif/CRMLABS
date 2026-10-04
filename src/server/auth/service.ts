import { and, eq, gt, isNull, sql, desc } from "drizzle-orm";
import { db } from "../db";
import { authTokens, loginAttempts, memberships, organizations, sessions, users } from "../db/schema";
import { hashPassword, randomToken, sha256, verifyPassword } from "../crypto";
import { AppError, invalid } from "../errors";
import type { Ctx } from "../context";
import { sendMail } from "../mail";
import { appUrl } from "../env";

export const SESSION_COOKIE = "crmlabs_session";
const SHORT_SESSION_MS = 12 * 60 * 60 * 1000; // 12 h
const REMEMBER_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const RESET_TTL_MS = 60 * 60 * 1000; // 1 h
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export const PASSWORD_MIN = 10;

export function validatePassword(pw: string) {
  if (pw.length < PASSWORD_MIN) throw invalid(`A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`);
  if (pw.length > 200) throw invalid("Senha longa demais.");
}

const normalizeEmail = (e: string) => e.trim().toLowerCase();

async function assertNotRateLimited(keys: string[]) {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS);
  for (const key of keys) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.key, key), eq(loginAttempts.success, false), gt(loginAttempts.createdAt, since)));
    if ((row?.n ?? 0) >= MAX_FAILURES) {
      throw new AppError("rate_limited", "Muitas tentativas. Aguarde alguns minutos e tente novamente.");
    }
  }
}

export type LoginResult = { token: string; expiresAt: Date; remember: boolean };

/** Autentica e cria sessão. Mensagem de erro genérica para não revelar se o e-mail existe. */
export async function login(input: {
  email: string;
  password: string;
  remember: boolean;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<LoginResult> {
  const email = normalizeEmail(input.email);
  const keys = [`email:${email}`, ...(input.ip ? [`ip:${input.ip}`] : [])];
  await assertNotRateLimited(keys);

  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  const ok = await verifyPassword(input.password, user?.passwordHash);

  let membership: typeof memberships.$inferSelect | undefined;
  if (ok && user) {
    [membership] = await db
      .select()
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(and(eq(memberships.userId, user.id), eq(memberships.status, "active")))
      .orderBy(organizations.isDemo, memberships.createdAt)
      .limit(1)
      .then((r) => r.map((x) => x.memberships));
  }

  if (ok && user && !membership) {
    // Senha correta, mas o acesso ainda não foi liberado: dizer isso só a quem provou ser o dono da conta.
    const [pending] = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.status, "pending")))
      .limit(1);
    if (pending) throw new AppError("forbidden", "Sua conta está aguardando a aprovação do administrador. Você receberá um e-mail quando for liberada.");
  }
  if (!ok || !user || !membership) {
    await db.insert(loginAttempts).values(keys.map((key) => ({ key, success: false })));
    throw new AppError("unauthenticated", "E-mail ou senha incorretos.");
  }

  await db.insert(loginAttempts).values({ key: `email:${email}`, success: true });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  return createSession(user.id, membership.orgId, input.remember, input.ip, input.userAgent);
}

export async function createSession(
  userId: string,
  orgId: string,
  remember: boolean,
  ip?: string | null,
  userAgent?: string | null,
): Promise<LoginResult> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (remember ? REMEMBER_SESSION_MS : SHORT_SESSION_MS));
  await db.insert(sessions).values({
    tokenHash: sha256(token),
    userId,
    orgId,
    remember,
    expiresAt,
    ip: ip ?? null,
    userAgent: userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt, remember };
}

/** Resolve o contexto a partir do token. Usuário desativado ou sessão expirada => null. */
export async function resolveSession(token: string | undefined | null): Promise<Ctx | null> {
  if (!token) return null;
  const rows = await db
    .select({ s: sessions, u: users, m: memberships, o: organizations })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(memberships, and(eq(memberships.userId, sessions.userId), eq(memberships.orgId, sessions.orgId)))
    .innerJoin(organizations, eq(organizations.id, sessions.orgId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row || row.m.status !== "active") return null;
  // Atualiza "visto por último" no máximo a cada 5 minutos.
  if (Date.now() - row.s.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.s.id));
  }
  return {
    userId: row.u.id,
    userName: row.u.name,
    userEmail: row.u.email,
    orgId: row.o.id,
    role: row.m.role,
    sessionId: row.s.id,
    org: {
      name: row.o.name,
      isDemo: row.o.isDemo,
      sharedInbox: row.o.sharedInbox,
      timezone: row.o.timezone,
      autoEntryStageId: row.o.autoEntryStageId,
    },
  };
}

export async function revokeSession(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
}

export async function revokeAllUserSessions(userId: string, orgId?: string) {
  await db
    .delete(sessions)
    .where(orgId ? and(eq(sessions.userId, userId), eq(sessions.orgId, orgId)) : eq(sessions.userId, userId));
}

/** Troca a organização ativa da sessão (somente para organizações em que o usuário é membro ativo). */
export async function switchOrg(ctx: Ctx, orgId: string) {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, ctx.userId), eq(memberships.orgId, orgId), eq(memberships.status, "active")));
  if (!m) throw new AppError("forbidden", "Você não pertence a esta organização.");
  await db.update(sessions).set({ orgId }).where(eq(sessions.id, ctx.sessionId));
}

export async function listUserOrgs(userId: string) {
  return db
    .select({ id: organizations.id, name: organizations.name, isDemo: organizations.isDemo, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
    .orderBy(organizations.isDemo, organizations.name);
}

// ---------- Recuperação de senha ----------

/** Sempre retorna sem erro para não revelar se o e-mail existe. */
export async function requestPasswordReset(emailRaw: string, ip?: string | null) {
  const email = normalizeEmail(emailRaw);
  const key = `reset:${ip ?? "?"}`;
  const since = new Date(Date.now() - FAILURE_WINDOW_MS);
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), gt(loginAttempts.createdAt, since)));
  if ((count?.n ?? 0) >= 10) return; // silenciosamente ignora abuso
  await db.insert(loginAttempts).values({ key, success: false });

  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!user) return;
  const [active] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.status, "active")))
    .limit(1);
  if (!active) return;

  const token = await createResetToken(user.id);
  const link = `${appUrl()}/redefinir-senha?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: user.email,
    subject: "CRMLABS — redefinição de senha",
    text: `Olá, ${user.name}.\n\nRecebemos um pedido para redefinir sua senha no CRMLABS. O link abaixo vale por 1 hora e só pode ser usado uma vez:\n\n${link}\n\nSe você não fez esse pedido, ignore este e-mail.`,
  });
}

/** Cria um link de redefinição de uso único (1 hora), invalidando os anteriores. */
export async function createResetToken(userId: string) {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.kind, "reset"), isNull(authTokens.usedAt)));
  const token = randomToken(32);
  await db.insert(authTokens).values({ userId, kind: "reset", tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
  return token;
}

/** Troca de senha pelo próprio usuário logado (exige a senha atual). Encerra as outras sessões. */
export async function changePassword(ctx: Ctx, current: string, next: string) {
  const [u] = await db.select().from(users).where(eq(users.id, ctx.userId));
  if (!(await verifyPassword(current, u?.passwordHash))) throw new AppError("invalid", "A senha atual não confere.", { fields: { current: "A senha atual não confere." } });
  validatePassword(next);
  await db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, ctx.userId));
  await db.delete(sessions).where(and(eq(sessions.userId, ctx.userId), sql`${sessions.id} <> ${ctx.sessionId}`));
}

async function consumeToken(kind: "reset" | "invite", token: string) {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.kind, kind),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .returning();
  if (!row) throw new AppError("invalid", "Este link é inválido, expirou ou já foi usado. Solicite um novo.");
  return row;
}

export async function resetPassword(token: string, newPassword: string) {
  validatePassword(newPassword);
  const row = await consumeToken("reset", token);
  await db.update(users).set({ passwordHash: await hashPassword(newPassword) }).where(eq(users.id, row.userId));
  await revokeAllUserSessions(row.userId);
}

// ---------- Convites ----------

export async function createInviteToken(userId: string, orgId: string) {
  await db
    .update(authTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(authTokens.userId, userId), eq(authTokens.orgId, orgId), eq(authTokens.kind, "invite"), isNull(authTokens.usedAt)));
  const token = randomToken(32);
  await db.insert(authTokens).values({
    userId,
    orgId,
    kind: "invite",
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });
  return token;
}

export async function getInvite(token: string) {
  const [row] = await db
    .select({ t: authTokens, u: users, o: organizations })
    .from(authTokens)
    .innerJoin(users, eq(users.id, authTokens.userId))
    .innerJoin(organizations, eq(organizations.id, authTokens.orgId))
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.kind, "invite"),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(authTokens.createdAt))
    .limit(1);
  if (!row) return null;
  return { name: row.u.name, email: row.u.email, orgName: row.o.name, hasPassword: !!row.u.passwordHash };
}

export async function acceptInvite(token: string, password: string | null, name?: string) {
  const row = await consumeToken("invite", token);
  if (!row.orgId) throw invalid("Convite inválido.");
  const [user] = await db.select().from(users).where(eq(users.id, row.userId));
  if (!user.passwordHash) {
    if (!password) throw invalid("Defina uma senha para continuar.");
    validatePassword(password);
  }
  await db.transaction(async (tx) => {
    const patch: Partial<typeof users.$inferInsert> = {};
    if (password && !user.passwordHash) patch.passwordHash = await hashPassword(password);
    if (name?.trim()) patch.name = name.trim();
    if (Object.keys(patch).length) await tx.update(users).set(patch).where(eq(users.id, user.id));
    const [m] = await tx
      .update(memberships)
      .set({ status: "active" })
      .where(and(eq(memberships.userId, user.id), eq(memberships.orgId, row.orgId!), eq(memberships.status, "invited")))
      .returning();
    if (!m) throw new AppError("invalid", "Este convite não está mais disponível. Fale com o administrador.");
  });
  return createSession(user.id, row.orgId, false);
}
