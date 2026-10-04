import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { memberships, users } from "../db/schema";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { AppError, invalid, notFound } from "../errors";
import { createInviteToken, revokeAllUserSessions } from "../auth/service";
import { sendMail } from "../mail";
import { appUrl } from "../env";
import { audit } from "./common";

export const roleSchema = z.enum(["admin", "manager", "seller", "closer"]);

/** Lista leve da equipe (nomes para seletores e exibição de responsáveis). */
export async function listMembers(ctx: Ctx) {
  const rows = await db
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: memberships.role,
      status: memberships.status,
      requestNote: memberships.requestNote,
      requestedAt: memberships.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, ctx.orgId))
    .orderBy(asc(users.name));
  const isAdmin = ctx.role === "admin" || ctx.role === "manager";
  // Pedidos pendentes só aparecem para quem pode aprová-los.
  return rows
    .filter((r) => r.status !== "pending" || ctx.role === "admin")
    .map((r) => (isAdmin ? r : { ...r, email: undefined, lastLoginAt: undefined, requestNote: undefined }));
}

export async function assertMember(orgId: string, userId: string, opts: { activeOnly?: boolean } = {}) {
  const [m] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  if (!m || (opts.activeOnly && m.status !== "active")) throw invalid("Responsável inválido para esta organização.");
  return m;
}

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  email: z.string().trim().email("E-mail inválido.").max(200),
  role: roleSchema,
});

export async function inviteMember(ctx: Ctx, input: z.infer<typeof inviteSchema>) {
  assertCan(ctx, "team.manage");
  const email = input.email.toLowerCase();
  let [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
  if (!user) [user] = await db.insert(users).values({ email, name: input.name }).returning();
  const [existing] = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, user.id)));
  if (existing?.status === "active") throw new AppError("conflict", "Esta pessoa já faz parte da equipe.");
  if (existing?.status === "pending") throw new AppError("conflict", "Esta pessoa já pediu acesso. Aprove o pedido na lista de solicitações.");
  if (existing) {
    await db.update(memberships).set({ role: input.role, status: "invited" }).where(eq(memberships.id, existing.id));
  } else {
    await db.insert(memberships).values({ orgId: ctx.orgId, userId: user.id, role: input.role, status: "invited" });
  }
  const sent = await sendInvite(ctx, user.id);
  await audit(db, ctx, "member.invited", "user", user.id, { role: input.role });
  return { userId: user.id, ...sent };
}

export async function sendInvite(ctx: Ctx, userId: string) {
  assertCan(ctx, "team.manage");
  const m = await assertMember(ctx.orgId, userId);
  if (m.status !== "invited") throw invalid("Só é possível reenviar convites pendentes.");
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  const token = await createInviteToken(userId, ctx.orgId);
  const link = `${appUrl()}/convite?token=${encodeURIComponent(token)}`;
  const emailed = await sendMail({
    to: user.email,
    subject: `Convite para o CRMLABS — ${ctx.org.name}`,
    text: `Olá, ${user.name}.\n\n${ctx.userName} convidou você para a equipe ${ctx.org.name} no CRMLABS.\nAcesse o link abaixo para definir sua senha. Ele vale por 7 dias e só pode ser usado uma vez:\n\n${link}`,
  });
  // Sem e-mail configurado, o link volta para o administrador enviar por outro canal.
  return emailed ? { emailed: true as const } : { emailed: false as const, link };
}

/**
 * Link de acesso de uso único (1 hora) para um membro ativo definir uma nova senha.
 * Útil quando não há e-mail configurado: o administrador copia e envia o link.
 */
export async function createAccessLink(ctx: Ctx, userId: string) {
  assertCan(ctx, "team.manage");
  const m = await assertMember(ctx.orgId, userId);
  if (m.status !== "active") throw invalid("Só é possível gerar link para membros ativos.");
  const { createResetToken } = await import("../auth/service");
  const token = await createResetToken(userId);
  await audit(db, ctx, "member.access_link", "user", userId);
  return { link: `${appUrl()}/redefinir-senha?token=${encodeURIComponent(token)}` };
}

export const updateMemberSchema = z.object({
  role: roleSchema.optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export async function updateMember(ctx: Ctx, userId: string, input: z.infer<typeof updateMemberSchema>) {
  assertCan(ctx, "team.manage");
  const m = await assertMember(ctx.orgId, userId);
  if (!m) throw notFound();
  if (userId === ctx.userId && (input.status === "disabled" || (input.role && input.role !== "admin"))) {
    throw invalid("Você não pode remover seu próprio acesso de administrador.");
  }
  if (input.status === "active" && m.status === "invited") {
    throw invalid("Este convite ainda não foi aceito.");
  }
  if (m.status === "pending") throw invalid("Responda ao pedido de acesso com Aprovar ou Recusar.");
  const patch: Partial<typeof memberships.$inferInsert> = {};
  if (input.role) patch.role = input.role;
  if (input.status) patch.status = input.status;
  if (!Object.keys(patch).length) return;
  await db.update(memberships).set(patch).where(eq(memberships.id, m.id));
  // Usuário desativado perde acesso imediatamente.
  // (O papel é lido a cada requisição, então mudanças de papel valem sem novo login.)
  if (input.status === "disabled") await revokeAllUserSessions(userId, ctx.orgId);
  await audit(db, ctx, "member.updated", "user", userId, patch);
}
