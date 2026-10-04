import { and, asc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { loginAttempts, memberships, organizations, users } from "../db/schema";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { AppError, invalid, notFound } from "../errors";
import { hashPassword } from "../crypto";
import { sendMail } from "../mail";
import { appUrl } from "../env";
import { audit, cleanText, notifyUser } from "../services/common";
import { publish } from "../realtime";
import { logger } from "../logger";
import { PASSWORD_MIN, validatePassword } from "./service";

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome.").max(120),
  email: z.string().trim().email("Informe um e-mail válido.").max(200),
  password: z.string().min(PASSWORD_MIN, `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`).max(200),
  note: z.string().max(300).optional(),
});

const NEUTRAL = "Pedido enviado. Assim que o administrador aprovar, você poderá entrar com este e-mail e senha.";
const MAX_PER_HOUR = 5;

/** Organização que recebe pedidos de acesso: a primeira organização real com cadastro aberto. */
export async function signupOrganization() {
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.isDemo, false), eq(organizations.allowSignup, true)))
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  return org ?? null;
}

/**
 * Cria um pedido de acesso pendente. A resposta é sempre a mesma, exista ou não o e-mail,
 * para não revelar quem já tem conta. Ninguém entra antes da aprovação do administrador.
 */
export async function requestSignup(input: z.infer<typeof signupSchema>, ip?: string | null) {
  const org = await signupOrganization();
  if (!org) throw new AppError("forbidden", "O cadastro está fechado no momento. Fale com o administrador.");

  const key = `signup:${ip ?? "?"}`;
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.key, key), gt(loginAttempts.createdAt, new Date(Date.now() - 60 * 60 * 1000))));
  if ((count?.n ?? 0) >= MAX_PER_HOUR) throw new AppError("rate_limited", "Muitos pedidos deste dispositivo. Tente novamente mais tarde.");
  await db.insert(loginAttempts).values({ key, success: true });

  validatePassword(input.password);
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  const note = cleanText(input.note, 300);

  const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (existing) {
    const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, existing.id)));
    // Pessoa que já tem acesso ou convite: avisa por e-mail, sem alterar senha nem revelar nada na tela.
    if (m?.status !== "pending") {
      await sendMail({
        to: existing.email,
        subject: "CRMLABS — pedido de cadastro",
        text: `Olá, ${existing.name}.\n\nRecebemos um pedido de cadastro com este e-mail, mas você já tem acesso ao CRMLABS. Entre em ${appUrl()}/login ou use "Esqueci minha senha".\n\nSe não foi você, ignore este e-mail.`,
      }).catch((e) => logger.warn("Falha ao enviar aviso de cadastro duplicado", e));
      return { message: NEUTRAL };
    }
    // Pedido pendente repetido: atualiza nome, senha e mensagem.
    await db.update(users).set({ name, passwordHash: await hashPassword(input.password) }).where(eq(users.id, existing.id));
    await db.update(memberships).set({ requestNote: note }).where(eq(memberships.id, m.id));
    return { message: NEUTRAL };
  }

  const userId = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({ email, name, passwordHash: await hashPassword(input.password) }).returning();
    await tx.insert(memberships).values({ orgId: org.id, userId: u.id, role: "seller", status: "pending", requestNote: note });
    await audit(tx, { orgId: org.id, userId: u.id }, "member.requested", "user", u.id);
    return u.id;
  });

  const admins = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, org.id), eq(memberships.role, "admin"), eq(memberships.status, "active")));
  for (const a of admins) {
    await notifyUser({ orgId: org.id, userId: a.userId, type: "member.requested", title: `Pedido de acesso: ${name}`, body: email, link: "/configuracoes?aba=equipe" });
  }
  await publish({ orgId: org.id, topic: "settings", managersOnly: true });
  logger.info("Novo pedido de acesso", { userId });
  return { message: NEUTRAL };
}

export const approveSchema = z.object({ role: z.enum(["admin", "manager", "seller", "closer"]) });

async function pendingMembership(ctx: Ctx, userId: string) {
  const [m] = await db.select().from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
  if (!m) throw notFound("Pedido não encontrado.");
  if (m.status !== "pending") throw invalid("Este pedido já foi respondido.");
  return m;
}

/** Administrador aprova o pedido e define o papel. A pessoa recebe um e-mail avisando. */
export async function approveSignup(ctx: Ctx, userId: string, input: z.infer<typeof approveSchema>) {
  assertCan(ctx, "team.manage", "Somente administradores aprovam pedidos de acesso.");
  const m = await pendingMembership(ctx, userId);
  await db.update(memberships).set({ status: "active", role: input.role }).where(eq(memberships.id, m.id));
  await audit(db, ctx, "member.approved", "user", userId, { role: input.role });
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  await sendMail({
    to: u.email,
    subject: `CRMLABS — acesso aprovado (${ctx.org.name})`,
    text: `Olá, ${u.name}.\n\nSeu acesso ao CRMLABS foi aprovado. Entre em ${appUrl()}/login com o e-mail e a senha que você cadastrou.`,
  }).catch((e) => logger.warn("Falha ao enviar e-mail de aprovação", e));
  await publish({ orgId: ctx.orgId, topic: "settings", managersOnly: true });
}

/** Recusa o pedido. Remove o pedido e, se a pessoa não tiver outro acesso, a conta criada no cadastro. */
export async function rejectSignup(ctx: Ctx, userId: string) {
  assertCan(ctx, "team.manage", "Somente administradores recusam pedidos de acesso.");
  const m = await pendingMembership(ctx, userId);
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  await db.transaction(async (tx) => {
    await tx.delete(memberships).where(eq(memberships.id, m.id));
    const others = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId));
    if (!others.length) await tx.delete(users).where(eq(users.id, userId));
    await audit(tx, ctx, "member.rejected", "user", null, { email: u.email, name: u.name });
  });
  await publish({ orgId: ctx.orgId, topic: "settings", managersOnly: true });
}
