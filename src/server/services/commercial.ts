import { and, asc, desc, eq, gte, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { appointments, contacts, opportunities, pipelineStages, stageHistory, users } from "../db/schema";
import type { Ctx } from "../context";
import { appointmentScope, assertCan, can, contactScope, opportunityScope } from "../permissions";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, cleanText, getPipeline, notifyUser } from "./common";
import { assertMember } from "./team";
import { listStages, getStageInOrg } from "./stages";
import { activeEntryFor } from "./board";

const cents = z.coerce.number().int("Use centavos inteiros.").min(0).max(1_000_000_000_00);

export const opportunityInputSchema = z.object({
  contactId: z.string().uuid(),
  title: z.string().trim().min(1, "Informe o título.").max(160),
  product: z.string().trim().max(160).nullish(),
  valueCents: cents.default(0),
  closerId: z.string().uuid().nullish(),
  stageId: z.string().uuid().nullish(),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida").nullish(),
});

const oppSelect = {
  id: opportunities.id,
  title: opportunities.title,
  product: opportunities.product,
  valueCents: opportunities.valueCents,
  currency: opportunities.currency,
  status: opportunities.status,
  stageId: opportunities.stageId,
  version: opportunities.version,
  expectedCloseDate: opportunities.expectedCloseDate,
  closedAt: opportunities.closedAt,
  lostReason: opportunities.lostReason,
  contactId: opportunities.contactId,
  contactName: contacts.name,
  contactUsername: contacts.username,
  closerId: opportunities.closerId,
  closerName: users.name,
  createdAt: opportunities.createdAt,
};

export const listOpportunitiesSchema = z.object({
  status: z.enum(["open", "won", "lost", "all"]).default("open"),
  closerId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
});

export async function listOpportunities(ctx: Ctx, f: z.infer<typeof listOpportunitiesSchema>) {
  const conds: SQL[] = [opportunityScope(ctx)];
  if (f.status !== "all") conds.push(eq(opportunities.status, f.status));
  if (f.closerId) conds.push(eq(opportunities.closerId, f.closerId));
  if (f.q) conds.push(sql`(${opportunities.title} ilike ${"%" + f.q + "%"} or ${contacts.name} ilike ${"%" + f.q + "%"})`);
  const rows = await db
    .select(oppSelect)
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .leftJoin(users, eq(users.id, opportunities.closerId))
    .where(and(...conds))
    .orderBy(desc(opportunities.updatedAt))
    .limit(300);
  const stages = await listStages(ctx, "sales");
  return { stages, rows };
}

async function getVisibleOpportunity(ctx: Ctx, id: string) {
  const [o] = await db.select().from(opportunities).where(and(eq(opportunities.id, id), opportunityScope(ctx)));
  if (!o) throw notFound("Oportunidade não encontrada.");
  return o;
}

async function assertCloser(ctx: Ctx, closerId: string | null | undefined) {
  if (!closerId) return;
  const m = await assertMember(ctx.orgId, closerId, { activeOnly: true });
  if (!["closer", "manager", "admin"].includes(m.role)) throw invalid("O responsável comercial precisa ter papel de closer, gestor ou administrador.");
}

export async function createOpportunity(ctx: Ctx, input: z.infer<typeof opportunityInputSchema>) {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), contactScope(ctx)));
  if (!contact) throw invalid("Contato inválido.");
  await assertCloser(ctx, input.closerId);
  const stage = input.stageId ? await getStageInOrg(ctx.orgId, input.stageId, "sales") : (await listStages(ctx, "sales"))[0];
  if (!stage) throw invalid("O funil comercial não tem etapas.");
  const closerId = input.closerId ?? (ctx.role === "closer" ? ctx.userId : null);
  const opp = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(opportunities)
      .values({
        orgId: ctx.orgId,
        contactId: contact.id,
        title: input.title,
        product: cleanText(input.product, 160),
        valueCents: input.valueCents,
        closerId,
        stageId: stage.id,
        expectedCloseDate: input.expectedCloseDate ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.insert(stageHistory).values({
      orgId: ctx.orgId,
      entityType: "opportunity",
      entityId: o.id,
      contactId: contact.id,
      toStageId: stage.id,
      toStageName: stage.name,
      actorId: ctx.userId,
      reason: "Oportunidade criada",
    });
    await audit(tx, ctx, "opportunity.created", "opportunity", o.id, { valueCents: o.valueCents });
    return o;
  });
  if (closerId && closerId !== ctx.userId) {
    await notifyUser({ orgId: ctx.orgId, userId: closerId, type: "opportunity.assigned", title: `Nova oportunidade: ${opp.title}`, body: `Contato: ${contact.name}`, link: "/comercial" });
  }
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: opp.id, ownerIds: [closerId, contact.ownerId] });
  return opp;
}

export const updateOpportunitySchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  product: z.string().trim().max(160).nullish(),
  valueCents: cents.optional(),
  closerId: z.string().uuid().nullish(),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  stageId: z.string().uuid().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export async function updateOpportunity(ctx: Ctx, id: string, input: z.infer<typeof updateOpportunitySchema>) {
  const o = await getVisibleOpportunity(ctx, id);
  if (input.expectedVersion && input.expectedVersion !== o.version) {
    throw new AppError("conflict", "Esta oportunidade foi alterada por outra pessoa. Os dados foram atualizados.", { currentVersion: o.version });
  }
  const isDecider = can(ctx, "opportunity.decide");
  if (!isDecider && (input.valueCents !== undefined || input.closerId !== undefined || input.stageId !== undefined)) {
    throw forbidden("Somente closers, gestores e administradores alteram valor, etapa ou responsável comercial.");
  }
  if (input.closerId !== undefined && input.closerId !== o.closerId) {
    if (ctx.role === "closer" && input.closerId !== ctx.userId) assertCan(ctx, "contacts.assign", "Somente gestores redistribuem oportunidades.");
    await assertCloser(ctx, input.closerId);
  }
  const patch: Partial<typeof opportunities.$inferInsert> = { updatedAt: new Date(), version: o.version + 1 };
  if (input.title !== undefined) patch.title = input.title;
  if (input.product !== undefined) patch.product = cleanText(input.product, 160);
  if (input.valueCents !== undefined) patch.valueCents = input.valueCents;
  if (input.closerId !== undefined) patch.closerId = input.closerId;
  if (input.expectedCloseDate !== undefined) patch.expectedCloseDate = input.expectedCloseDate;
  let to: Awaited<ReturnType<typeof getStageInOrg>> | null = null;
  if (input.stageId && input.stageId !== o.stageId) {
    to = await getStageInOrg(ctx.orgId, input.stageId, "sales");
    if (to.archivedAt) throw invalid("Etapa arquivada.");
    patch.stageId = to.id;
  }
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(opportunities).set(patch).where(and(eq(opportunities.id, o.id), eq(opportunities.version, o.version))).returning();
    if (!u) throw new AppError("conflict", "Esta oportunidade foi alterada por outra pessoa. Os dados foram atualizados.");
    if (to) {
      const [from] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, o.stageId));
      await tx.insert(stageHistory).values({
        orgId: ctx.orgId,
        entityType: "opportunity",
        entityId: o.id,
        contactId: o.contactId,
        fromStageId: o.stageId,
        toStageId: to.id,
        fromStageName: from?.name,
        toStageName: to.name,
        actorId: ctx.userId,
      });
    }
    return u;
  });
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: o.id, ownerIds: [o.closerId, updated.closerId] });
  return updated;
}

export const decideSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("won"), valueCents: cents.optional(), closedAt: z.coerce.date().optional() }),
  z.object({ status: z.literal("lost"), lostReason: z.string().trim().min(3, "Informe o motivo da perda.").max(300), closedAt: z.coerce.date().optional() }),
  z.object({ status: z.literal("open") }),
]);

/** Ganhar, perder ou reabrir. Métricas são recalculadas a partir do estado atual; histórico é mantido. */
export async function decideOpportunity(ctx: Ctx, id: string, input: z.infer<typeof decideSchema>) {
  assertCan(ctx, "opportunity.decide", "Somente closers, gestores e administradores registram ganhos e perdas.");
  const o = await getVisibleOpportunity(ctx, id);
  if (input.status === o.status) throw invalid("A oportunidade já está neste status.");
  const patch: Partial<typeof opportunities.$inferInsert> = { status: input.status, updatedAt: new Date(), version: o.version + 1 };
  if (input.status === "won") {
    patch.closedAt = input.closedAt ?? new Date();
    patch.lostReason = null;
    if (input.valueCents !== undefined) patch.valueCents = input.valueCents;
  } else if (input.status === "lost") {
    patch.closedAt = input.closedAt ?? new Date();
    patch.lostReason = input.lostReason;
  } else {
    patch.closedAt = null;
  }
  const label = { won: "Ganha", lost: "Perdida", open: "Reaberta" }[input.status];
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(opportunities).set(patch).where(eq(opportunities.id, o.id)).returning();
    await tx.insert(stageHistory).values({
      orgId: ctx.orgId,
      entityType: "opportunity",
      entityId: o.id,
      contactId: o.contactId,
      fromStageId: o.stageId,
      toStageId: o.stageId,
      actorId: ctx.userId,
      reason: `Status: ${label}${input.status === "lost" ? ` — ${input.lostReason}` : ""}`,
    });
    await audit(tx, ctx, `opportunity.${input.status === "open" ? "reopened" : input.status}`, "opportunity", o.id, {
      previous: { status: o.status, closedAt: o.closedAt, valueCents: o.valueCents },
      next: { status: u.status, closedAt: u.closedAt, valueCents: u.valueCents },
    });
    return u;
  });
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: o.id, ownerIds: [o.closerId] });
  return updated;
}

// ---------- Encaminhar ao closer ----------
export const forwardSchema = z.object({
  closerId: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  valueCents: cents.default(0),
  nextStep: z.string().trim().min(3, "Descreva o próximo passo.").max(300),
  dueAt: z.coerce.date().nullish(),
});

/** Encaminha a oportunidade mantendo o mesmo contato, vínculo e histórico. */
export async function forwardToCloser(ctx: Ctx, contactId: string, input: z.infer<typeof forwardSchema>) {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!contact) throw notFound("Contato não encontrado.");
  await assertCloser(ctx, input.closerId);
  const opp = await createOpportunity(ctx, { contactId, title: input.title, valueCents: input.valueCents, closerId: input.closerId });

  // Move o cartão para a etapa "Encaminhado ao closer", se existir e o contato estiver no quadro.
  const rel = await getPipeline(ctx.orgId, "relationship");
  const [target] = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, rel.id), eq(pipelineStages.key, "encaminhado-closer"), isNull(pipelineStages.archivedAt)));
  const entry = await activeEntryFor(contact.id, ctx.orgId);
  if (target && entry && entry.stageId !== target.id) {
    const { moveEntry } = await import("./board");
    await moveEntry(ctx, entry.id, { toStageId: target.id, expectedVersion: entry.version });
  }
  const { createTask } = await import("./tasks");
  if (input.closerId === ctx.userId || can(ctx, "contacts.assign")) {
    await createTask(ctx, { title: input.nextStep, contactId: contact.id, opportunityId: opp.id, ownerId: input.closerId, dueAt: input.dueAt ?? null });
  } else {
    // Seller não atribui tarefas a terceiros: o próximo passo vai como notificação ao closer.
    await notifyUser({ orgId: ctx.orgId, userId: input.closerId, type: "opportunity.forwarded", title: `Encaminhado: ${contact.name}`, body: `Próximo passo: ${input.nextStep}`, link: "/comercial" });
  }
  return opp;
}

// ---------- Reuniões ----------
export const appointmentInputSchema = z
  .object({
    contactId: z.string().uuid(),
    opportunityId: z.string().uuid().nullish(),
    ownerId: z.string().uuid().nullish(),
    title: z.string().trim().min(1, "Informe o título.").max(160),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    timezone: z.string().max(60).default("America/Bahia"),
    location: z.string().trim().max(300).nullish(),
    notes: z.string().max(2000).nullish(),
  })
  .refine((v) => v.endsAt > v.startsAt, { message: "O fim deve ser depois do início.", path: ["endsAt"] });

export const listAppointmentsSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.enum(["scheduled", "done", "canceled", "no_show", "all"]).default("all"),
});

export async function listAppointments(ctx: Ctx, f: z.infer<typeof listAppointmentsSchema>) {
  const conds: SQL[] = [appointmentScope(ctx)];
  if (f.from) conds.push(gte(appointments.startsAt, f.from));
  if (f.to) conds.push(lt(appointments.startsAt, f.to));
  if (f.status !== "all") conds.push(eq(appointments.status, f.status));
  return db
    .select({
      id: appointments.id,
      title: appointments.title,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      timezone: appointments.timezone,
      location: appointments.location,
      status: appointments.status,
      notes: appointments.notes,
      contactId: appointments.contactId,
      contactName: contacts.name,
      opportunityId: appointments.opportunityId,
      ownerId: appointments.ownerId,
      ownerName: users.name,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(users, eq(users.id, appointments.ownerId))
    .where(and(...conds))
    .orderBy(asc(appointments.startsAt))
    .limit(200);
}

export async function createAppointment(ctx: Ctx, input: z.infer<typeof appointmentInputSchema>) {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), contactScope(ctx)));
  if (!contact) throw invalid("Contato inválido.");
  const ownerId = input.ownerId ?? ctx.userId;
  if (ownerId !== ctx.userId && !can(ctx, "contacts.assign")) throw forbidden("Somente gestores agendam para outras pessoas.");
  await assertMember(ctx.orgId, ownerId, { activeOnly: true });
  if (input.opportunityId) await getVisibleOpportunity(ctx, input.opportunityId);
  const [a] = await db
    .insert(appointments)
    .values({
      orgId: ctx.orgId,
      contactId: contact.id,
      opportunityId: input.opportunityId ?? null,
      ownerId,
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: input.timezone,
      location: cleanText(input.location, 300),
      notes: cleanText(input.notes),
    })
    .returning();
  await audit(db, ctx, "appointment.created", "appointment", a.id);
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: a.id, ownerIds: [ownerId, contact.ownerId] });
  return a;
}

export const updateAppointmentSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  location: z.string().trim().max(300).nullish(),
  notes: z.string().max(2000).nullish(),
  status: z.enum(["scheduled", "done", "canceled", "no_show"]).optional(),
});

export async function updateAppointment(ctx: Ctx, id: string, input: z.infer<typeof updateAppointmentSchema>) {
  const [a] = await db.select().from(appointments).where(and(eq(appointments.id, id), appointmentScope(ctx)));
  if (!a) throw notFound("Reunião não encontrada.");
  const startsAt = input.startsAt ?? a.startsAt;
  const endsAt = input.endsAt ?? a.endsAt;
  if (endsAt <= startsAt) throw invalid("O fim deve ser depois do início.");
  const [u] = await db
    .update(appointments)
    .set({
      ...input,
      location: input.location !== undefined ? cleanText(input.location, 300) : undefined,
      notes: input.notes !== undefined ? cleanText(input.notes) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(appointments.id, a.id))
    .returning();
  if (input.status && input.status !== a.status) await audit(db, ctx, "appointment.status", "appointment", a.id, { from: a.status, to: input.status });
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: a.id, ownerIds: [a.ownerId] });
  return u;
}
