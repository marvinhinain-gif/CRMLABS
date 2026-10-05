import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { contacts, memberships, users } from "../db/schema";
import type { Ctx } from "../context";
import { formatBRL, formatDateTime } from "@/lib/format";
import { logger } from "../logger";
import { notifyUser } from "./common";

type Alert = { type: string; title: string; body?: string; link?: string };

/** Administradores ativos da organização. */
async function adminIds(orgId: string) {
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, "admin"), eq(memberships.status, "active")));
  return rows.map((r) => r.userId);
}

/**
 * Envia o alerta a cada destinatário (sem repetir e sem avisar quem fez a ação).
 * Falhas aqui nunca desfazem a operação principal.
 */
async function send(ctx: Ctx, recipients: (string | null | undefined)[], alert: Alert) {
  const ids = [...new Set(recipients.filter((x): x is string => !!x && x !== ctx.userId))];
  if (!ids.length) return;
  // Só quem continua ativo na organização recebe.
  const active = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.status, "active"), inArray(memberships.userId, ids)));
  for (const { userId } of active) {
    try {
      await notifyUser({ orgId: ctx.orgId, userId, ...alert });
    } catch (e) {
      logger.warn("Falha ao criar notificação", e);
    }
  }
}

const contactLink = (contactId: string, base = "/social-seller") => `${base}?contato=${contactId}`;

/** Lead mudou de etapa no funil de relacionamento (Social Seller). Para administradores. */
export async function alertLeadStage(ctx: Ctx, input: { contactId: string; contactName: string; from: string | null; to: string }) {
  await send(ctx, await adminIds(ctx.orgId), {
    type: "lead.stage_changed",
    title: `${input.contactName} → ${input.to}`,
    body: `${input.from ? `Saiu de “${input.from}”` : "Entrou no funil"} · por ${ctx.userName}`,
    link: contactLink(input.contactId),
  });
}

/** Oportunidade mudou de etapa no funil comercial. Para administradores. */
export async function alertOpportunityStage(ctx: Ctx, input: { contactName: string; title: string; from: string | null; to: string }) {
  await send(ctx, await adminIds(ctx.orgId), {
    type: "opportunity.stage_changed",
    title: `${input.contactName} → ${input.to}`,
    body: `${input.title}${input.from ? ` · saiu de “${input.from}”` : ""} · por ${ctx.userName}`,
    link: "/comercial",
  });
}

/** Reunião agendada. Para administradores. */
export async function alertMeeting(ctx: Ctx, input: { contactId: string; title: string; startsAt: Date; ownerId: string }) {
  const [c] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, input.contactId));
  const [owner] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.ownerId));
  await send(ctx, await adminIds(ctx.orgId), {
    type: "meeting.scheduled",
    title: `Reunião agendada com ${c?.name ?? "contato"}`,
    body: `${formatDateTime(input.startsAt)} · ${input.title} · com ${owner?.name ?? ctx.userName}`,
    link: "/comercial?aba=reunioes",
  });
}

/**
 * Venda fechada: valor, vendedor (closer) e social seller (responsável pelo contato).
 * Vai para os administradores e para quem participou da venda.
 */
export async function alertSale(ctx: Ctx, input: { contactId: string; title: string; valueCents: number; closerId: string | null }) {
  const [c] = await db.select({ name: contacts.name, ownerId: contacts.ownerId }).from(contacts).where(eq(contacts.id, input.contactId));
  const ids = [input.closerId, c?.ownerId].filter((x): x is string => !!x);
  const names = new Map(
    ids.length ? (await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : [],
  );
  const closer = input.closerId ? names.get(input.closerId) : null;
  const seller = c?.ownerId ? names.get(c.ownerId) : null;
  await send(ctx, [...(await adminIds(ctx.orgId)), input.closerId, c?.ownerId], {
    type: "sale.won",
    title: `🎉 Venda fechada: ${formatBRL(input.valueCents)}`,
    body: `${c?.name ?? "Contato"} · ${input.title}\nVendedor: ${closer ?? "—"} · Social seller: ${seller ?? "—"}`,
    link: "/comercial?aba=ganhas",
  });
}
