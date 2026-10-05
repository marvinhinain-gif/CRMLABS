import { and, asc, desc, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "../db";
import { appointments, contactTags, contacts, leadForms, leads, memberships, notes, opportunities, pipelineStages, products, stageHistory, tags, users } from "../db/schema";
import type { Ctx } from "../context";
import { appointmentScope, assertCan, can, contactScope, opportunityScope, ROLE_LABEL } from "../permissions";
import { AppError, forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, cleanText, getPipeline, notifyUser, salesPipelineFor } from "./common";
import { recordContactMade, recordDecision, recordForward, recordMeetingStatus, recordStageMove } from "./salesEvents";
import { assertMember } from "./team";
import { listStages, getStageInOrg } from "./stages";
import { activeEntryFor } from "./board";
import { alertMeeting, alertOpportunityStage, alertSale } from "./alerts";
import { logger } from "../logger";

const cents = z.coerce.number().int("Use centavos inteiros.").min(0).max(1_000_000_000_00);

export const opportunityInputSchema = z.object({
  contactId: z.string().uuid(),
  title: z.string().trim().min(1, "Informe o título.").max(160),
  product: z.string().trim().max(160).nullish(),
  productId: z.string().uuid().nullish(),
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
  sellerId: opportunities.sellerId,
  forwardedAt: opportunities.forwardedAt,
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
    .select({ ...oppSelect, stageName: pipelineStages.name, sellerName: sql<string | null>`(select u.name from ${users} u where u.id = ${opportunities.sellerId})` })
    .from(opportunities)
    .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
    .leftJoin(users, eq(users.id, opportunities.closerId))
    .leftJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(...conds))
    .orderBy(desc(opportunities.updatedAt))
    .limit(300);
  const stages = await listStages(ctx, "sales", { ownerId: ctx.role === "closer" ? ctx.userId : (f.closerId ?? null) });
  return { stages, rows };
}

async function getVisibleOpportunity(ctx: Ctx, id: string) {
  const [o] = await db.select().from(opportunities).where(and(eq(opportunities.id, id), opportunityScope(ctx)));
  if (!o) throw notFound("Oportunidade não encontrada.");
  return o;
}

async function assertCloser(ctx: Ctx, closerId: string | null | undefined) {
  if (!closerId) return null;
  const m = await assertMember(ctx.orgId, closerId, { activeOnly: true });
  if (!["closer", "manager", "admin"].includes(m.role)) throw invalid("O responsável comercial precisa ter papel de closer, gestor ou administrador.");
  return m;
}

type StageRow = typeof pipelineStages.$inferSelect;

async function stagesOf(pipelineId: string, tx: DbOrTx = db) {
  return tx
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, pipelineId), isNull(pipelineStages.archivedAt)))
    .orderBy(asc(pipelineStages.position));
}

/** Etapa de mesmo significado em outro funil (ex.: ao trocar de closer). */
function equivalent(list: StageRow[], type: string | null | undefined, fallback: "entry" | "negotiation" = "entry") {
  return list.find((s) => s.stageType === type) ?? list.find((s) => s.stageType === fallback) ?? list.find((s) => s.stageType === "entry") ?? list[0];
}

/** Social seller que recebe o crédito: quem encaminha (se seller) ou o dono do contato (se seller). */
async function sellerFor(ctx: Ctx, contactOwnerId: string | null) {
  if (ctx.role === "seller") return ctx.userId;
  if (!contactOwnerId) return null;
  const [m] = await db.select({ role: memberships.role }).from(memberships).where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, contactOwnerId)));
  return m?.role === "seller" ? contactOwnerId : null;
}

async function latestLeadProduct(orgId: string, contactId: string) {
  const [l] = await db
    .select({ productId: leads.productId, productName: products.name })
    .from(leads)
    .leftJoin(products, eq(products.id, leads.productId))
    .where(and(eq(leads.orgId, orgId), eq(leads.contactId, contactId)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  return l ?? null;
}

export async function createOpportunity(ctx: Ctx, input: z.infer<typeof opportunityInputSchema>, opts: { reason?: string; silent?: boolean; forwarded?: boolean } = {}) {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), contactScope(ctx)));
  if (!contact) throw invalid("Contato inválido.");
  await assertCloser(ctx, input.closerId);
  const closerId = input.closerId ?? (ctx.role === "closer" ? ctx.userId : null);
  const pipeline = await salesPipelineFor(ctx.orgId, closerId);
  const list = await stagesOf(pipeline.id);
  let stage = input.stageId ? list.find((s) => s.id === input.stageId) : equivalent(list, "entry");
  if (input.stageId && !stage) {
    // Etapa de outro funil (ex.: funil padrão escolhido na integração): usa a de mesmo tipo no funil do closer.
    const other = await getStageInOrg(ctx.orgId, input.stageId, "sales");
    stage = equivalent(list, other.stageType);
  }
  if (!stage) throw invalid("O funil comercial não tem etapas.");
  if (stage.stageType === "won" || stage.stageType === "lost") stage = equivalent(list, "entry");
  let productId = input.productId ?? null;
  let product = cleanText(input.product, 160);
  if (productId) {
    const [p] = await db.select().from(products).where(and(eq(products.id, productId), eq(products.orgId, ctx.orgId)));
    if (!p) throw invalid("Produto inválido.");
    product ??= p.name;
  } else if (!product) {
    const l = await latestLeadProduct(ctx.orgId, contact.id);
    productId = l?.productId ?? null;
    product = l?.productName ?? null;
  }
  const sellerId = await sellerFor(ctx, contact.ownerId);
  const opp = await db.transaction(async (tx) => {
    const [o] = await tx
      .insert(opportunities)
      .values({
        orgId: ctx.orgId,
        contactId: contact.id,
        title: input.title,
        product,
        productId,
        valueCents: input.valueCents,
        closerId,
        sellerId,
        forwardedAt: opts.forwarded ? new Date() : null,
        stageId: stage!.id,
        expectedCloseDate: input.expectedCloseDate ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.insert(stageHistory).values({
      orgId: ctx.orgId,
      entityType: "opportunity",
      entityId: o.id,
      contactId: contact.id,
      toStageId: stage!.id,
      toStageName: stage!.name,
      actorId: ctx.userId,
      reason: opts.reason ?? "Oportunidade criada",
    });
    await audit(tx, ctx, "opportunity.created", "opportunity", o.id, { valueCents: o.valueCents });
    return o;
  });
  if (!opts.silent && closerId && closerId !== ctx.userId) {
    await notifyUser({ orgId: ctx.orgId, userId: closerId, type: "opportunity.assigned", title: `Nova oportunidade: ${opp.title}`, body: `Contato: ${contact.name}`, link: `/comercial?op=${opp.id}` });
  }
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: opp.id, ownerIds: [closerId, contact.ownerId] });
  return opp;
}

export const updateOpportunitySchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  product: z.string().trim().max(160).nullish(),
  productId: z.string().uuid().nullish(),
  valueCents: cents.optional(),
  closerId: z.string().uuid().nullish(),
  expectedCloseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  stageId: z.string().uuid().optional(),
  expectedVersion: z.number().int().positive().optional(),
  /** Ao arrastar para "Venda ganha". */
  wonValueCents: cents.optional(),
  /** Ao arrastar para "Venda perdida". */
  lostReason: z.string().trim().max(300).optional(),
});

/** Efeitos de entrar numa etapa com significado (contato, reunião realizada). */
async function applyStageEffects(ctx: Ctx, o: typeof opportunities.$inferSelect, to: StageRow) {
  if (to.stageType === "contacted") await recordContactMade(ctx, o.contactId);
  if (to.stageType === "meeting_done") {
    // Conclui a reunião pendente mais recente; sem reunião registrada, registra uma já realizada.
    const [pending] = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.orgId, ctx.orgId), eq(appointments.contactId, o.contactId), eq(appointments.status, "scheduled"), lt(appointments.startsAt, new Date(Date.now() + 12 * 3600_000))))
      .orderBy(desc(appointments.startsAt))
      .limit(1);
    if (pending) await updateAppointment(ctx, pending.id, { status: "done" }, { skipScope: true, internal: true });
    else {
      const end = new Date();
      const a = await createAppointment(
        ctx,
        { contactId: o.contactId, opportunityId: o.id, ownerId: o.closerId ?? ctx.userId, title: "Reunião", startsAt: new Date(end.getTime() - 3600_000), endsAt: end, timezone: ctx.org.timezone, notes: "Registrada ao mover o lead para “" + to.name + "”." },
        { silent: true },
      );
      await updateAppointment(ctx, a.id, { status: "done" }, { skipScope: true, internal: true });
    }
  }
}

export async function updateOpportunity(ctx: Ctx, id: string, input: z.infer<typeof updateOpportunitySchema>) {
  const o = await getVisibleOpportunity(ctx, id);
  if (input.expectedVersion && input.expectedVersion !== o.version) {
    throw new AppError("conflict", "Esta oportunidade foi alterada por outra pessoa. Os dados foram atualizados.", { currentVersion: o.version });
  }
  const isDecider = can(ctx, "opportunity.decide");
  if (!isDecider && (input.valueCents !== undefined || input.closerId !== undefined || input.stageId !== undefined)) {
    throw forbidden("Somente closers, gestores e administradores alteram valor, etapa ou responsável comercial.");
  }
  const [current] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, o.stageId));
  let target: StageRow | null = null;
  let reason: string | null = null;
  // Troca de closer: o lead vai para a etapa equivalente no funil do novo closer.
  if (input.closerId !== undefined && input.closerId !== o.closerId) {
    if (ctx.role === "closer" && input.closerId !== ctx.userId) assertCan(ctx, "contacts.assign", "Somente gestores redistribuem oportunidades.");
    await assertCloser(ctx, input.closerId);
    const list = await stagesOf((await salesPipelineFor(ctx.orgId, input.closerId)).id);
    target = equivalent(list, current?.stageType);
    const [nu] = input.closerId ? await db.select({ name: users.name }).from(users).where(eq(users.id, input.closerId)) : [];
    reason = `Responsável comercial: ${nu?.name ?? "sem closer"}`;
  }
  if (input.stageId && input.stageId !== o.stageId) {
    const to = await getStageInOrg(ctx.orgId, input.stageId, "sales");
    if (to.archivedAt) throw invalid("Etapa arquivada.");
    if (current && to.pipelineId !== (target?.pipelineId ?? current.pipelineId)) throw invalid("Etapa de outro funil.");
    target = to;
  }
  // Arrastar para Venda ganha / perdida = registrar o fechamento.
  if (target && (target.stageType === "won" || target.stageType === "lost") && o.status === "open") {
    if (target.stageType === "won") {
      const value = input.wonValueCents ?? input.valueCents ?? Number(o.valueCents);
      if (!value) throw invalid("Informe o valor da venda.", { fields: { wonValueCents: "Informe o valor da venda." }, need: "wonValueCents" });
      return decideOpportunity(ctx, o.id, { status: "won", valueCents: value }, { stageId: target.id });
    }
    if (!input.lostReason || input.lostReason.length < 3) throw invalid("Informe o motivo da perda.", { fields: { lostReason: "Informe o motivo da perda." }, need: "lostReason" });
    return decideOpportunity(ctx, o.id, { status: "lost", lostReason: input.lostReason }, { stageId: target.id });
  }
  // Tirar de Venda ganha / perdida = reabrir.
  if (target && o.status !== "open" && target.stageType !== "won" && target.stageType !== "lost") {
    await decideOpportunity(ctx, o.id, { status: "open" }, { stageId: target.id });
    return (await db.select().from(opportunities).where(eq(opportunities.id, o.id)))[0];
  }
  const fresh = (await db.select().from(opportunities).where(eq(opportunities.id, o.id)))[0];
  const patch: Partial<typeof opportunities.$inferInsert> = { updatedAt: new Date(), version: fresh.version + 1 };
  if (input.title !== undefined) patch.title = input.title;
  if (input.product !== undefined) patch.product = cleanText(input.product, 160);
  if (input.productId !== undefined) {
    if (input.productId) {
      const [p] = await db.select().from(products).where(and(eq(products.id, input.productId), eq(products.orgId, ctx.orgId)));
      if (!p) throw invalid("Produto inválido.");
      patch.product = p.name;
    }
    patch.productId = input.productId;
  }
  if (input.valueCents !== undefined) patch.valueCents = input.valueCents;
  if (input.closerId !== undefined) patch.closerId = input.closerId;
  if (input.expectedCloseDate !== undefined) patch.expectedCloseDate = input.expectedCloseDate;
  if (target && target.id !== fresh.stageId) patch.stageId = target.id;
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(opportunities).set(patch).where(and(eq(opportunities.id, o.id), eq(opportunities.version, fresh.version))).returning();
    if (!u) throw new AppError("conflict", "Esta oportunidade foi alterada por outra pessoa. Os dados foram atualizados.");
    if (patch.stageId && target) {
      await tx.insert(stageHistory).values({
        orgId: ctx.orgId,
        entityType: "opportunity",
        entityId: o.id,
        contactId: o.contactId,
        fromStageId: o.stageId,
        toStageId: target.id,
        fromStageName: current?.name,
        toStageName: target.name,
        actorId: ctx.userId,
        reason,
      });
      await recordStageMove(ctx, u, current?.stageType ?? null, target.stageType, tx);
    }
    return u;
  });
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: o.id, ownerIds: [o.closerId, updated.closerId, o.sellerId] });
  if (patch.stageId && target) {
    await applyStageEffects(ctx, updated, target).catch((e) => logger.warn("Falha ao aplicar efeitos da etapa", e));
    const [c] = await db.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, o.contactId));
    await alertOpportunityStage(ctx, { contactName: c?.name ?? "Contato", title: updated.title, from: current?.name ?? null, to: target.name }).catch((e) => logger.warn("Falha no alerta de etapa comercial", e));
    if (input.closerId !== undefined && input.closerId && input.closerId !== ctx.userId) {
      await notifyUser({ orgId: ctx.orgId, userId: input.closerId, type: "opportunity.assigned", title: `🔥 Novo Lead recebido`, body: `${c?.name ?? "Um lead"} foi encaminhado para você por ${ctx.userName}.`, link: `/comercial?op=${o.id}` });
    }
  }
  return updated;
}

export const decideSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("won"), valueCents: cents.optional(), closedAt: z.coerce.date().optional() }),
  z.object({ status: z.literal("lost"), lostReason: z.string().trim().min(3, "Informe o motivo da perda.").max(300), closedAt: z.coerce.date().optional() }),
  z.object({ status: z.literal("open") }),
]);

/** Ganhar, perder ou reabrir. Grava o evento (anula o anterior ao reabrir) e põe o cartão na coluna certa. */
export async function decideOpportunity(ctx: Ctx, id: string, input: z.infer<typeof decideSchema>, opts: { stageId?: string } = {}) {
  assertCan(ctx, "opportunity.decide", "Somente closers, gestores e administradores registram ganhos e perdas.");
  const o = await getVisibleOpportunity(ctx, id);
  if (input.status === o.status) throw invalid("A oportunidade já está neste status.");
  const [current] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, o.stageId));
  const list = current ? await stagesOf(current.pipelineId) : [];
  let target: StageRow | undefined = opts.stageId ? list.find((s) => s.id === opts.stageId) : undefined;
  if (!target) {
    if (input.status === "won" || input.status === "lost") target = list.find((s) => s.stageType === input.status);
    else if (current?.stageType === "won" || current?.stageType === "lost") target = equivalent(list, "negotiation", "negotiation");
  }
  const patch: Partial<typeof opportunities.$inferInsert> = { status: input.status, updatedAt: new Date(), version: o.version + 1 };
  if (target && target.id !== o.stageId) patch.stageId = target.id;
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
      toStageId: u.stageId,
      fromStageName: current?.name,
      toStageName: target?.name ?? current?.name,
      actorId: ctx.userId,
      reason: `Status: ${label}${input.status === "lost" ? ` — ${input.lostReason}` : ""}`,
    });
    await recordDecision(ctx, u, tx);
    if (patch.stageId) await recordStageMove(ctx, u, current?.stageType ?? null, target?.stageType ?? null, tx);
    await audit(tx, ctx, `opportunity.${input.status === "open" ? "reopened" : input.status}`, "opportunity", o.id, {
      previous: { status: o.status, closedAt: o.closedAt, valueCents: o.valueCents },
      next: { status: u.status, closedAt: u.closedAt, valueCents: u.valueCents },
    });
    return u;
  });
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: o.id, ownerIds: [o.closerId, o.sellerId] });
  if (input.status === "won") {
    await alertSale(ctx, { contactId: updated.contactId, title: updated.title, valueCents: Number(updated.valueCents), closerId: updated.closerId }).catch((e) => logger.warn("Falha no alerta de venda", e));
  }
  return updated;
}

// ---------- Encaminhar ao closer ----------
export const forwardSchema = z.object({
  closerId: z.string().uuid(),
  /** Observação para o closer (fica nas anotações do lead). */
  note: z.string().trim().max(2000).nullish(),
  title: z.string().trim().max(160).nullish(),
  valueCents: cents.optional(),
  nextStep: z.string().trim().max(300).nullish(),
  dueAt: z.coerce.date().nullish(),
});

/** Situação do encaminhamento de um contato: para quem foi, quando e em que etapa está. */
export async function forwardStatus(ctx: Ctx, contactId: string) {
  const [contact] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!contact) throw notFound("Contato não encontrado.");
  const [o] = await db
    .select({
      id: opportunities.id,
      status: opportunities.status,
      closerId: opportunities.closerId,
      closerName: users.name,
      forwardedAt: opportunities.forwardedAt,
      createdAt: opportunities.createdAt,
      stageName: pipelineStages.name,
      valueCents: opportunities.valueCents,
    })
    .from(opportunities)
    .leftJoin(users, eq(users.id, opportunities.closerId))
    .leftJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
    .where(and(eq(opportunities.contactId, contactId), eq(opportunities.orgId, ctx.orgId)))
    .orderBy(sql`${opportunities.status} = 'open' desc`, desc(opportunities.createdAt))
    .limit(1);
  const closers = await db
    .select({ id: users.id, name: users.name })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.status, "active"), eq(memberships.role, "closer")))
    .orderBy(asc(users.name));
  return { current: o ? { ...o, forwardedAt: o.forwardedAt ?? o.createdAt } : null, closers };
}

/**
 * Social seller encaminha o lead qualificado: ele entra na etapa "Novo lead" do Kanban do closer escolhido,
 * com todo o histórico do contato. Se já houver oportunidade aberta, ela é transferida (sem duplicar).
 */
export async function forwardToCloser(ctx: Ctx, contactId: string, input: z.infer<typeof forwardSchema>) {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!contact) throw notFound("Contato não encontrado.");
  await assertCloser(ctx, input.closerId);
  const [closer] = await db.select({ name: users.name }).from(users).where(eq(users.id, input.closerId));
  const [open] = await db.select().from(opportunities).where(and(eq(opportunities.contactId, contact.id), eq(opportunities.orgId, ctx.orgId), eq(opportunities.status, "open")));
  const who = `${ROLE_LABEL[ctx.role]} — ${ctx.userName}`;
  const reason = `Lead qualificado por ${who} · encaminhado para Closer — ${closer?.name ?? "?"}`;
  let opp: typeof opportunities.$inferSelect;
  if (open) {
    if (open.closerId === input.closerId) throw invalid(`Este lead já está com ${closer?.name ?? "este closer"}.`);
    const list = await stagesOf((await salesPipelineFor(ctx.orgId, input.closerId)).id);
    const entry = equivalent(list, "entry");
    const [from] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, open.stageId));
    opp = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(opportunities)
        .set({ closerId: input.closerId, stageId: entry.id, sellerId: open.sellerId ?? (await sellerFor(ctx, contact.ownerId)), forwardedAt: new Date(), updatedAt: new Date(), version: open.version + 1 })
        .where(eq(opportunities.id, open.id))
        .returning();
      await tx.insert(stageHistory).values({ orgId: ctx.orgId, entityType: "opportunity", entityId: open.id, contactId: contact.id, fromStageId: open.stageId, toStageId: entry.id, fromStageName: from?.name, toStageName: entry.name, actorId: ctx.userId, reason });
      return u;
    });
  } else {
    const product = await latestLeadProduct(ctx.orgId, contact.id);
    opp = await createOpportunity(
      ctx,
      { contactId: contact.id, title: input.title?.trim() || (product?.productName ? `${product.productName} — ${contact.name}` : contact.name), valueCents: input.valueCents ?? 0, closerId: input.closerId },
      { reason, silent: true, forwarded: true },
    );
  }
  await recordForward(ctx, opp);
  if (input.note?.trim()) {
    await db.insert(notes).values({ orgId: ctx.orgId, contactId: contact.id, authorId: ctx.userId, body: `Ao encaminhar para ${closer?.name ?? "o closer"}: ${input.note.trim()}` });
  }

  // O cartão do Social Seller vai para "Encaminhado ao closer", se existir.
  const rel = await getPipeline(ctx.orgId, "relationship");
  const [target] = await db
    .select()
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, rel.id), eq(pipelineStages.key, "encaminhado-closer"), isNull(pipelineStages.archivedAt)));
  const entry = await activeEntryFor(contact.id, ctx.orgId);
  if (target && entry && entry.stageId !== target.id) {
    const { moveEntry } = await import("./board");
    await moveEntry(ctx, entry.id, { toStageId: target.id, expectedVersion: entry.version }).catch((e) => logger.warn("Falha ao mover o cartão do social seller", e));
  }
  if (input.nextStep?.trim()) {
    const { createTask } = await import("./tasks");
    await createTask(ctx, { title: input.nextStep.trim(), contactId: contact.id, opportunityId: opp.id, ownerId: input.closerId, dueAt: input.dueAt ?? null });
  }
  if (input.closerId !== ctx.userId) {
    await notifyUser({
      orgId: ctx.orgId,
      userId: input.closerId,
      type: "opportunity.forwarded",
      title: "🔥 Novo Lead recebido",
      body: `${contact.name} foi encaminhad${/a$/i.test(contact.name.split(" ")[0]) ? "a" : "o"} para você por ${ctx.userName.split(" ")[0]}.`,
      link: `/comercial?op=${opp.id}`,
    });
  }
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: opp.id, ownerIds: [input.closerId, contact.ownerId] });
  return { ...opp, closerName: closer?.name ?? null };
}

const FLOW = ["entry", "contacted", "scheduled", "meeting_done", "follow_up", "negotiation"];

/**
 * O CRM organiza sozinho: reunião marcada ou realizada avança o lead no Kanban do closer
 * (somente para frente, nunca volta etapas nem mexe em vendas fechadas).
 */
async function autoAdvance(ctx: Ctx, contactId: string, toType: "scheduled" | "meeting_done", reason: string) {
  try {
    const [o] = await db.select().from(opportunities).where(and(eq(opportunities.contactId, contactId), eq(opportunities.orgId, ctx.orgId), eq(opportunities.status, "open"))).orderBy(desc(opportunities.updatedAt)).limit(1);
    if (!o) return;
    const [cur] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, o.stageId));
    if (!cur) return;
    const curIdx = FLOW.indexOf(cur.stageType);
    if (curIdx === -1 || curIdx >= FLOW.indexOf(toType)) return;
    const to = (await stagesOf(cur.pipelineId)).find((s) => s.stageType === toType);
    if (!to) return;
    await db.transaction(async (tx) => {
      const [u] = await tx.update(opportunities).set({ stageId: to.id, version: o.version + 1, updatedAt: new Date() }).where(and(eq(opportunities.id, o.id), eq(opportunities.version, o.version))).returning();
      if (!u) return;
      await tx.insert(stageHistory).values({ orgId: ctx.orgId, entityType: "opportunity", entityId: o.id, contactId, fromStageId: cur.id, toStageId: to.id, fromStageName: cur.name, toStageName: to.name, actorId: ctx.userId, reason: `Automático: ${reason}` });
      await recordStageMove(ctx, u, cur.stageType, to.stageType, tx);
    });
    await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: o.id, ownerIds: [o.closerId, o.sellerId] });
  } catch (e) {
    logger.warn("Falha ao avançar o lead no Kanban", e);
  }
}

// ---------- Kanban comercial ----------
export const boardSchema = z.object({ ownerId: z.string().uuid().optional() });

/** Kanban do closer (gestores escolhem de quem). Mostra abertas + fechadas nos últimos 30 dias. */
export async function getCommercialBoard(ctx: Ctx, f: z.infer<typeof boardSchema>) {
  if (ctx.role === "seller") throw forbidden("O Kanban comercial é dos closers. Acompanhe seus encaminhamentos na aba Encaminhados.");
  const people = can(ctx, "data.all")
    ? await db
        .select({ id: users.id, name: users.name, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.status, "active"), inArray(memberships.role, ["closer", "manager", "admin"])))
        .orderBy(sql`${memberships.role} <> 'closer'`, asc(users.name))
    : [];
  const ownerId = ctx.role === "closer" ? ctx.userId : (f.ownerId ?? people.find((p) => p.role === "closer")?.id ?? null);
  const pipeline = await salesPipelineFor(ctx.orgId, ownerId);
  const stages = await stagesOf(pipeline.id);

  // Autocorreção: oportunidade do closer que ficou em etapa de outro funil vai para a equivalente.
  if (ownerId) {
    const stray = await db
      .select({ id: opportunities.id, type: pipelineStages.stageType, status: opportunities.status })
      .from(opportunities)
      .innerJoin(pipelineStages, eq(pipelineStages.id, opportunities.stageId))
      .where(and(eq(opportunities.orgId, ctx.orgId), eq(opportunities.closerId, ownerId), sql`${pipelineStages.pipelineId} <> ${pipeline.id}`, sql`(${opportunities.status} = 'open' or ${opportunities.closedAt} > now() - interval '30 days')`));
    for (const s of stray) {
      const to = equivalent(stages, s.status === "open" ? s.type : s.status);
      if (to) await db.update(opportunities).set({ stageId: to.id }).where(eq(opportunities.id, s.id));
    }
  }

  const stageIds = stages.map((s) => s.id);
  const cards = stageIds.length
    ? await db
        .select({
          id: opportunities.id,
          title: opportunities.title,
          valueCents: opportunities.valueCents,
          status: opportunities.status,
          stageId: opportunities.stageId,
          version: opportunities.version,
          contactId: contacts.id,
          contactName: contacts.name,
          contactUsername: contacts.username,
          contactPhone: contacts.phone,
          avatarUrl: contacts.avatarUrl,
          product: opportunities.product,
          closedAt: opportunities.closedAt,
          lostReason: opportunities.lostReason,
          forwardedAt: opportunities.forwardedAt,
          createdAt: opportunities.createdAt,
          updatedAt: opportunities.updatedAt,
          sellerName: sql<string | null>`(select u.name from ${users} u where u.id = ${opportunities.sellerId})`,
          sourceName: sql<string | null>`(select s.name from lead_sources s where s.id = ${contacts.firstSourceId})`,
          sourceColor: sql<string | null>`(select s.color from lead_sources s where s.id = ${contacts.firstSourceId})`,
          nextMeetingAt: sql<string | null>`(select min(a.starts_at) from ${appointments} a where a.contact_id = ${contacts.id} and a.status = 'scheduled' and a.starts_at > now() - interval '2 hours')`,
          nextTaskAt: sql<string | null>`(select min(t.due_at) from tasks t where t.contact_id = ${contacts.id} and t.status <> 'done')`,
          openTasks: sql<number>`(select count(*)::int from tasks t where t.contact_id = ${contacts.id} and t.status <> 'done')`,
          enteredStageAt: sql<string | null>`(select max(h.created_at) from ${stageHistory} h where h.entity_id = ${opportunities.id} and h.to_stage_id = ${opportunities.stageId})`,
        })
        .from(opportunities)
        .innerJoin(contacts, eq(contacts.id, opportunities.contactId))
        .where(
          and(
            opportunityScope(ctx),
            inArray(opportunities.stageId, stageIds),
            ownerId ? eq(opportunities.closerId, ownerId) : isNull(opportunities.closerId),
            sql`(${opportunities.status} = 'open' or ${opportunities.closedAt} > now() - interval '30 days')`,
          ),
        )
        .orderBy(desc(opportunities.updatedAt))
        .limit(500)
    : [];
  return {
    ownerId,
    pipelineId: pipeline.id,
    canEdit: (!!ownerId && ownerId === ctx.userId) || can(ctx, "pipeline.edit"),
    people,
    stages: stages.map((s) => ({ id: s.id, key: s.key, name: s.name, color: s.color, position: s.position, stageType: s.stageType })),
    cards: cards.map((c) => ({ ...c, valueCents: Number(c.valueCents) })),
  };
}

/** Lead dentro do Comercial: tudo o que veio do social seller, do formulário e o histórico. */
export async function getOpportunityDetail(ctx: Ctx, id: string) {
  const o = await getVisibleOpportunity(ctx, id);
  const [contact] = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, username: contacts.username, avatarUrl: contacts.avatarUrl, summary: contacts.summary, ownerId: contacts.ownerId })
    .from(contacts)
    .where(eq(contacts.id, o.contactId));
  const [stage] = await db.select().from(pipelineStages).where(eq(pipelineStages.id, o.stageId));
  const stages = stage ? await stagesOf(stage.pipelineId) : [];
  const ids = [o.closerId, o.sellerId, contact?.ownerId].filter((x): x is string => !!x);
  const names = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const nameOf = (uid: string | null | undefined) => names.find((n) => n.id === uid)?.name ?? null;
  const [lead] = await db
    .select({ id: leads.id, answers: leads.answers, utm: leads.utm, preferredAt: leads.preferredAt, preferredText: leads.preferredText, createdAt: leads.createdAt, formName: leadForms.name, campaign: leads.campaign, custom: leads.custom })
    .from(leads)
    .leftJoin(leadForms, eq(leadForms.id, leads.formId))
    .where(and(eq(leads.contactId, o.contactId), eq(leads.orgId, ctx.orgId)))
    .orderBy(desc(leads.createdAt))
    .limit(1);
  const history = await db
    .select({ id: stageHistory.id, at: stageHistory.createdAt, from: stageHistory.fromStageName, to: stageHistory.toStageName, reason: stageHistory.reason, actorName: users.name })
    .from(stageHistory)
    .leftJoin(users, eq(users.id, stageHistory.actorId))
    .where(and(eq(stageHistory.entityType, "opportunity"), eq(stageHistory.entityId, o.id)))
    .orderBy(desc(stageHistory.createdAt))
    .limit(50);
  const noteRows = await db
    .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, authorName: users.name })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(eq(notes.contactId, o.contactId))
    .orderBy(desc(notes.createdAt))
    .limit(20);
  const meetings = await db
    .select({ id: appointments.id, title: appointments.title, startsAt: appointments.startsAt, status: appointments.status, location: appointments.location })
    .from(appointments)
    .where(and(eq(appointments.contactId, o.contactId), eq(appointments.orgId, ctx.orgId)))
    .orderBy(desc(appointments.startsAt))
    .limit(10);
  const { contactJourney } = await import("./journey");
  return {
    ...o,
    valueCents: Number(o.valueCents),
    closerName: nameOf(o.closerId),
    sellerName: nameOf(o.sellerId),
    stage: stage ? { id: stage.id, name: stage.name, color: stage.color, stageType: stage.stageType } : null,
    stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, stageType: s.stageType })),
    contact: contact ? { ...contact, ownerName: nameOf(contact.ownerId) } : null,
    lead: lead ?? null,
    history,
    notes: noteRows,
    meetings,
    journey: await contactJourney(ctx, o.contactId),
  };
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

export async function createAppointment(ctx: Ctx, input: z.infer<typeof appointmentInputSchema>, opts: { silent?: boolean } = {}) {
  const [contact] = await db.select().from(contacts).where(and(eq(contacts.id, input.contactId), contactScope(ctx)));
  if (!contact) throw invalid("Contato inválido.");
  const ownerId = input.ownerId ?? ctx.userId;
  const ownerMember = await assertMember(ctx.orgId, ownerId, { activeOnly: true });
  // Social sellers podem marcar para si ou direto com um closer; gestores, para qualquer pessoa.
  if (ownerId !== ctx.userId && !can(ctx, "contacts.assign") && ownerMember.role !== "closer") {
    throw forbidden("Você pode agendar para você ou para um closer.");
  }
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
      createdBy: ctx.userId,
    })
    .returning();
  await audit(db, ctx, "appointment.created", "appointment", a.id);
  await recordMeetingStatus(ctx, a, null).catch((e) => logger.warn("Falha ao registrar reunião agendada", e));
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: a.id, ownerIds: [ownerId, contact.ownerId] });
  if (!opts.silent) await autoAdvance(ctx, contact.id, "scheduled", "Reunião agendada");
  if (!opts.silent) await alertMeeting(ctx, { contactId: contact.id, title: a.title, startsAt: a.startsAt, ownerId }).catch((e) => logger.warn("Falha no alerta de reunião", e));
  // Agenda Google do responsável (se conectada): cria o evento e o link do Meet.
  const { syncSoon } = await import("./calendar");
  syncSoon(a.id);
  if (ownerId !== ctx.userId && !opts.silent) {
    await notifyUser({
      orgId: ctx.orgId,
      userId: ownerId,
      type: "meeting.assigned",
      title: `Reunião marcada para você: ${contact.name}`,
      body: `${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Bahia", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(a.startsAt)} · por ${ctx.userName}`,
      link: `/agendamentos?reuniao=${a.id}`,
    }).catch((e) => logger.warn("Falha ao avisar o responsável da reunião", e));
  }
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

export async function updateAppointment(ctx: Ctx, id: string, input: z.infer<typeof updateAppointmentSchema>, opts: { skipScope?: boolean; internal?: boolean } = {}) {
  const [a] = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.id, id), opts.skipScope ? eq(appointments.orgId, ctx.orgId) : appointmentScope(ctx)));
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
  if (input.status && input.status !== a.status) {
    await audit(db, ctx, "appointment.status", "appointment", a.id, { from: a.status, to: input.status });
    await recordMeetingStatus(ctx, u, a.status).catch((e) => logger.warn("Falha ao registrar status da reunião", e));
    if (input.status === "done" && !opts.internal) await autoAdvance(ctx, a.contactId, "meeting_done", "Reunião realizada");
  }
  // Reunião de lead cancelada: o lead volta para "em contato" para ser remarcado.
  if (a.leadId && input.status === "canceled" && a.status !== "canceled") {
    await db.update(leads).set({ status: "contacted", updatedAt: new Date() }).where(and(eq(leads.id, a.leadId), eq(leads.appointmentId, a.id)));
    await publish({ orgId: ctx.orgId, topic: "leads", entityId: a.leadId });
  }
  if (a.leadId && input.status === "scheduled" && a.status === "canceled") {
    await db.update(leads).set({ status: "scheduled", appointmentId: a.id, updatedAt: new Date() }).where(eq(leads.id, a.leadId));
    await publish({ orgId: ctx.orgId, topic: "leads", entityId: a.leadId });
  }
  await publish({ orgId: ctx.orgId, topic: "opportunities", entityId: a.id, ownerIds: [a.ownerId] });
  if (input.startsAt || input.endsAt || input.status || input.title || input.location !== undefined || input.notes !== undefined) {
    const { syncSoon } = await import("./calendar");
    syncSoon(a.id);
  }
  return u;
}

// ---------- Agendamentos (calendário com dados do cliente) ----------
export const agendaSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  ownerId: z.string().uuid().optional(),
  status: z.enum(["scheduled", "done", "canceled", "no_show", "all"]).default("all"),
});

export async function listAgenda(ctx: Ctx, f: z.infer<typeof agendaSchema>) {
  if (f.to.getTime() - f.from.getTime() > 62 * 86400000) throw invalid("Período grande demais.");
  const conds: SQL[] = [appointmentScope(ctx), gte(appointments.startsAt, f.from), lt(appointments.startsAt, f.to)];
  if (f.status !== "all") conds.push(eq(appointments.status, f.status));
  if (f.ownerId && can(ctx, "data.all")) conds.push(eq(appointments.ownerId, f.ownerId));
  return db
    .select({
      id: appointments.id,
      title: appointments.title,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      status: appointments.status,
      location: appointments.location,
      ownerId: appointments.ownerId,
      ownerName: users.name,
      contactId: contacts.id,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactUsername: contacts.username,
      contactAvatar: contacts.avatarUrl,
      leadId: appointments.leadId,
      fromLead: sql<boolean>`${appointments.leadId} is not null`,
      leadStatus: leads.status,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(users, eq(users.id, appointments.ownerId))
    .leftJoin(leads, eq(leads.id, appointments.leadId))
    .where(and(...conds))
    .orderBy(asc(appointments.startsAt))
    .limit(500);
}

/** Reunião com tudo sobre o cliente: contato, respostas do formulário do anúncio e oportunidade. */
export async function getAgendaItem(ctx: Ctx, id: string) {
  const [a] = await db.select().from(appointments).where(and(eq(appointments.id, id), appointmentScope(ctx)));
  if (!a) throw notFound("Reunião não encontrada.");
  const [contact] = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone, email: contacts.email, username: contacts.username, avatarUrl: contacts.avatarUrl, summary: contacts.summary, source: contacts.source, ownerId: contacts.ownerId, createdAt: contacts.createdAt })
    .from(contacts)
    .where(eq(contacts.id, a.contactId));
  const people = [a.ownerId, contact?.ownerId].filter((x): x is string => !!x);
  const names = people.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, people)) : [];
  const nameOf = (uid: string | null | undefined) => names.find((n) => n.id === uid)?.name ?? null;
  let lead = null;
  if (a.leadId) {
    const [l] = await db
      .select({ id: leads.id, answers: leads.answers, utm: leads.utm, preferredAt: leads.preferredAt, preferredText: leads.preferredText, createdAt: leads.createdAt, formName: leadForms.name, channel: leads.channel })
      .from(leads)
      .leftJoin(leadForms, eq(leadForms.id, leads.formId))
      .where(eq(leads.id, a.leadId));
    lead = l ?? null;
  } else {
    // Sem vínculo direto: mostra o lead mais recente do mesmo contato, se houver.
    const [l] = await db
      .select({ id: leads.id, answers: leads.answers, utm: leads.utm, preferredAt: leads.preferredAt, preferredText: leads.preferredText, createdAt: leads.createdAt, formName: leadForms.name, channel: leads.channel })
      .from(leads)
      .leftJoin(leadForms, eq(leadForms.id, leads.formId))
      .where(and(eq(leads.contactId, a.contactId), eq(leads.orgId, ctx.orgId)))
      .orderBy(desc(leads.createdAt))
      .limit(1);
    lead = l ?? null;
  }
  let opportunity = null;
  if (a.opportunityId) {
    const [o] = await db.select({ id: opportunities.id, title: opportunities.title, valueCents: opportunities.valueCents, status: opportunities.status }).from(opportunities).where(eq(opportunities.id, a.opportunityId));
    opportunity = o ?? null;
  }
  const tagRows = await db.select({ name: tags.name }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId)).where(eq(contactTags.contactId, a.contactId));
  const history = await db
    .select({ id: appointments.id, startsAt: appointments.startsAt, status: appointments.status, title: appointments.title })
    .from(appointments)
    .where(and(eq(appointments.contactId, a.contactId), appointmentScope(ctx), sql`${appointments.id} <> ${a.id}`))
    .orderBy(desc(appointments.startsAt))
    .limit(5);
  // Ficha de preparação: anotações do social seller e jornada de origem.
  const noteRows = await db
    .select({ id: notes.id, body: notes.body, createdAt: notes.createdAt, authorName: users.name })
    .from(notes)
    .leftJoin(users, eq(users.id, notes.authorId))
    .where(eq(notes.contactId, a.contactId))
    .orderBy(desc(notes.createdAt))
    .limit(10);
  const { contactJourney } = await import("./journey");
  return {
    ...a,
    ownerName: nameOf(a.ownerId),
    contact: contact ? { ...contact, ownerName: nameOf(contact.ownerId), tags: tagRows.map((t) => t.name) } : null,
    lead,
    opportunity,
    history,
    sellerNotes: noteRows,
    journey: await contactJourney(ctx, a.contactId),
  };
}
