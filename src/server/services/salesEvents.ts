import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { db, type DbOrTx } from "../db";
import { appointments, contacts, leads, memberships, opportunities, organizations, salesEvents, type SalesEventType } from "../db/schema";
import { logger } from "../logger";

type Actor = { orgId: string; userId?: string | null };

/** Dimensões gravadas com o evento: origem, campanha, produto, social seller e closer. */
async function dimensions(tx: DbOrTx, orgId: string, contactId: string, opportunityId?: string | null) {
  const [c] = await tx.select({ ownerId: contacts.ownerId, firstSourceId: contacts.firstSourceId }).from(contacts).where(eq(contacts.id, contactId));
  const [lead] = await tx
    .select({ campaign: leads.campaign, productId: leads.productId, sourceId: leads.sourceId })
    .from(leads)
    .where(and(eq(leads.orgId, orgId), eq(leads.contactId, contactId)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  let opp: { sellerId: string | null; closerId: string | null; productId: string | null } | undefined;
  if (opportunityId) {
    [opp] = await tx.select({ sellerId: opportunities.sellerId, closerId: opportunities.closerId, productId: opportunities.productId }).from(opportunities).where(eq(opportunities.id, opportunityId));
  }
  let ownerIsSeller = false;
  if (c?.ownerId) {
    const [m] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, c.ownerId)));
    ownerIsSeller = m?.role === "seller";
  }
  return {
    sourceId: c?.firstSourceId ?? lead?.sourceId ?? null,
    campaign: lead?.campaign ?? null,
    productId: opp?.productId ?? lead?.productId ?? null,
    sellerId: opp?.sellerId ?? (ownerIsSeller ? c!.ownerId : null),
    closerId: opp?.closerId ?? null,
  };
}

async function roleOf(tx: DbOrTx, orgId: string, userId: string | null | undefined) {
  if (!userId) return null;
  const [m] = await tx.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return m?.role ?? null;
}

async function insertEvent(
  tx: DbOrTx,
  e: {
    orgId: string;
    type: SalesEventType;
    occurredAt?: Date;
    actorId?: string | null;
    contactId: string;
    opportunityId?: string | null;
    appointmentId?: string | null;
    valueCents?: number;
    fromStageType?: string | null;
    toStageType?: string | null;
    dedupeKey?: string | null;
    sellerId?: string | null;
    closerId?: string | null;
  },
) {
  const d = await dimensions(tx, e.orgId, e.contactId, e.opportunityId);
  // Quem age sendo social seller recebe o crédito quando o contato ainda não tem um.
  let sellerId = e.sellerId !== undefined ? e.sellerId : d.sellerId;
  if (!sellerId && (await roleOf(tx, e.orgId, e.actorId)) === "seller") sellerId = e.actorId ?? null;
  const rows = await tx
    .insert(salesEvents)
    .values({
      orgId: e.orgId,
      type: e.type,
      occurredAt: e.occurredAt ?? new Date(),
      actorId: e.actorId ?? null,
      contactId: e.contactId,
      opportunityId: e.opportunityId ?? null,
      appointmentId: e.appointmentId ?? null,
      sellerId,
      closerId: e.closerId !== undefined ? e.closerId : d.closerId,
      sourceId: d.sourceId,
      campaign: d.campaign,
      productId: d.productId,
      valueCents: e.valueCents ?? 0,
      fromStageType: e.fromStageType ?? null,
      toStageType: e.toStageType ?? null,
      dedupeKey: e.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: salesEvents.id });
  return rows.length > 0;
}

async function localDate(orgId: string, at: Date, tx: DbOrTx) {
  const [o] = await tx.select({ tz: organizations.timezone }).from(organizations).where(eq(organizations.id, orgId));
  const d = new TZDate(at.getTime(), o?.tz ?? "America/Bahia");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Contato realizado (mensagem enviada, "Falei", etapa de contato, reunião marcada). Conta uma vez por contato por dia. */
export async function recordContactMade(actor: Actor, contactId: string, tx: DbOrTx = db, at = new Date()) {
  try {
    return await insertEvent(tx, { orgId: actor.orgId, type: "contact_made", occurredAt: at, actorId: actor.userId, contactId, dedupeKey: `contact:${contactId}:${await localDate(actor.orgId, at, tx)}` });
  } catch (e) {
    logger.warn("Falha ao registrar contato realizado", e);
    return false;
  }
}

type ApptRow = typeof appointments.$inferSelect;

/** Eventos de reunião: agendada, realizada, falta, cancelada. Mudar de "realizada" para outro status anula o evento. */
export async function recordMeetingStatus(actor: Actor, a: ApptRow, previous: ApptRow["status"] | null, tx: DbOrTx = db) {
  if (previous === null) {
    await insertEvent(tx, { orgId: a.orgId, type: "meeting_scheduled", occurredAt: a.createdAt, actorId: actor.userId, contactId: a.contactId, opportunityId: a.opportunityId, appointmentId: a.id, closerId: a.ownerId, dedupeKey: `appt:${a.id}:scheduled` });
    await recordContactMade(actor, a.contactId, tx);
  }
  if (previous === a.status) return;
  const map: Partial<Record<ApptRow["status"], SalesEventType>> = { done: "meeting_done", no_show: "meeting_no_show", canceled: "meeting_canceled" };
  // Anula o evento do status anterior (ex.: marcada como realizada por engano).
  if (previous && map[previous]) {
    await tx
      .update(salesEvents)
      .set({ voidedAt: new Date() })
      .where(and(eq(salesEvents.orgId, a.orgId), eq(salesEvents.appointmentId, a.id), eq(salesEvents.type, map[previous]!), isNull(salesEvents.voidedAt)));
  }
  const type = map[a.status];
  if (!type) return;
  const at = a.status === "done" || a.status === "no_show" ? new Date(Math.min(a.endsAt.getTime(), Date.now())) : new Date();
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(salesEvents).where(and(eq(salesEvents.orgId, a.orgId), eq(salesEvents.appointmentId, a.id), eq(salesEvents.type, type)));
  await insertEvent(tx, { orgId: a.orgId, type, occurredAt: at, actorId: actor.userId, contactId: a.contactId, opportunityId: a.opportunityId, appointmentId: a.id, closerId: a.ownerId, dedupeKey: `appt:${a.id}:${a.status}:${n}` });
}

type OppRow = typeof opportunities.$inferSelect;

/** Venda ganha/perdida (ou reaberta, que anula os eventos de fechamento anteriores). */
export async function recordDecision(actor: Actor, o: OppRow, tx: DbOrTx = db) {
  await tx
    .update(salesEvents)
    .set({ voidedAt: new Date() })
    .where(and(eq(salesEvents.orgId, o.orgId), eq(salesEvents.opportunityId, o.id), inArray(salesEvents.type, ["sale_won", "sale_lost"]), isNull(salesEvents.voidedAt)));
  if (o.status === "open") return;
  await insertEvent(tx, {
    orgId: o.orgId,
    type: o.status === "won" ? "sale_won" : "sale_lost",
    occurredAt: o.closedAt ?? new Date(),
    actorId: actor.userId,
    contactId: o.contactId,
    opportunityId: o.id,
    valueCents: o.status === "won" ? Number(o.valueCents) : 0,
    dedupeKey: `opp:${o.id}:${o.status}:${o.version}`,
  });
}

export async function recordForward(actor: Actor, o: OppRow, tx: DbOrTx = db) {
  await insertEvent(tx, { orgId: o.orgId, type: "lead_forwarded", actorId: actor.userId, contactId: o.contactId, opportunityId: o.id, dedupeKey: `opp:${o.id}:forwarded:${o.closerId}` });
}

/** Movimento no kanban (base para tempo médio entre etapas). */
export async function recordStageMove(actor: Actor, o: OppRow, fromType: string | null, toType: string | null, tx: DbOrTx = db) {
  await insertEvent(tx, { orgId: o.orgId, type: "stage_moved", actorId: actor.userId, contactId: o.contactId, opportunityId: o.id, fromStageType: fromType, toStageType: toType });
}
