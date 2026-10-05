import { and, asc, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { addMonths, startOfMonth } from "date-fns";
import { z } from "zod";
import { db } from "../db";
import { contacts, leadSources, leads, memberships, products, salesEvents, salesGoals, users } from "../db/schema";
import type { Ctx } from "../context";
import { assertCan, can } from "../permissions";
import { invalid } from "../errors";
import { parseLocalDateTime, periodRange, tsz, type PeriodKey } from "../time";
import { audit } from "./common";
import { publish } from "../realtime";

export const commercialDashboardSchema = z.object({
  period: z.enum(["today", "7d", "30d", "month", "last_month", "custom"]).default("month"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sellerId: z.string().uuid().optional(),
  closerId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
  campaign: z.string().trim().max(160).optional(),
});
type Filters = z.infer<typeof commercialDashboardSchema>;

function monthKey(d: Date, tz: string) {
  const l = new TZDate(d.getTime(), tz);
  return `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(key: string, tz: string) {
  const [y, m] = key.split("-").map(Number);
  const start = new TZDate(y, m - 1, 1, 0, 0, 0, tz);
  const end = addMonths(start, 1);
  return { start: new Date(start.getTime()), end: new Date(end.getTime()) };
}

export function resolvePeriod(f: Filters, tz: string) {
  if (f.period === "custom") {
    if (!f.from || !f.to) throw invalid("Escolha o início e o fim do período.");
    const start = parseLocalDateTime(`${f.from}T00:00`, tz);
    const endDay = parseLocalDateTime(`${f.to}T00:00`, tz);
    if (!start || !endDay) throw invalid("Datas inválidas.");
    const end = new Date(new TZDate(endDay.getTime(), tz).getTime() + 86400000);
    if (end <= start) throw invalid("O fim precisa ser depois do início.");
    if (end.getTime() - start.getTime() > 400 * 86400000) throw invalid("Escolha um período de até 13 meses.");
    return { start, end };
  }
  return periodRange(f.period as PeriodKey, tz);
}

/** Quem vê o quê: gestores veem tudo (com filtros); social seller e closer, os próprios números. */
function scopeConds(ctx: Ctx, f: Filters): SQL[] {
  const c: SQL[] = [eq(salesEvents.orgId, ctx.orgId), isNull(salesEvents.voidedAt)];
  if (can(ctx, "data.all")) {
    if (f.sellerId) c.push(eq(salesEvents.sellerId, f.sellerId));
    if (f.closerId) c.push(eq(salesEvents.closerId, f.closerId));
  } else if (ctx.role === "closer") {
    c.push(sql`(${salesEvents.closerId} = ${ctx.userId} or ${salesEvents.actorId} = ${ctx.userId})`);
  } else {
    c.push(sql`(${salesEvents.sellerId} = ${ctx.userId} or ${salesEvents.actorId} = ${ctx.userId})`);
  }
  if (f.productId) c.push(eq(salesEvents.productId, f.productId));
  if (f.sourceId) c.push(eq(salesEvents.sourceId, f.sourceId));
  if (f.campaign) c.push(eq(salesEvents.campaign, f.campaign));
  return c;
}

const OUTER_CONTACT = sql.raw(`"contacts"."id"`);
const OUTER = { appointment: sql.raw(`"sales_events"."appointment_id"`), contact: sql.raw(`"sales_events"."contact_id"`), at: sql.raw(`"sales_events"."occurred_at"`) };

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export async function getCommercialDashboard(ctx: Ctx, f: Filters) {
  const tz = ctx.org.timezone;
  const { start, end } = resolvePeriod(f, tz);
  const inRange = [gte(salesEvents.occurredAt, start), lt(salesEvents.occurredAt, end)];
  const conds = [...scopeConds(ctx, f), ...inRange];

  const [k] = await db
    .select({
      contacts: sql<number>`count(distinct ${salesEvents.contactId}) filter (where ${salesEvents.type} = 'contact_made')::int`,
      scheduled: sql<number>`count(*) filter (where ${salesEvents.type} = 'meeting_scheduled')::int`,
      done: sql<number>`count(*) filter (where ${salesEvents.type} = 'meeting_done')::int`,
      noShow: sql<number>`count(*) filter (where ${salesEvents.type} = 'meeting_no_show')::int`,
      sales: sql<number>`count(*) filter (where ${salesEvents.type} = 'sale_won')::int`,
      revenue: sql<number>`coalesce(sum(${salesEvents.valueCents}) filter (where ${salesEvents.type} = 'sale_won'), 0)::bigint`,
      lost: sql<number>`count(*) filter (where ${salesEvents.type} = 'sale_lost')::int`,
      forwarded: sql<number>`count(*) filter (where ${salesEvents.type} = 'lead_forwarded')::int`,
    })
    .from(salesEvents)
    .where(and(...conds));
  const kpis = { ...k, revenueCents: Number(k.revenue), avgTicketCents: k.sales ? Math.round(Number(k.revenue) / k.sales) : 0 };

  // Meta do mês (da equipe toda): o mês do período escolhido, ou o mês atual.
  const goalMonth = f.period === "last_month" ? monthKey(new Date(start.getTime() + 3600_000), tz) : monthKey(new Date(), tz);
  const gm = monthRange(goalMonth, tz);
  const [goal] = await db.select().from(salesGoals).where(and(eq(salesGoals.orgId, ctx.orgId), eq(salesGoals.month, goalMonth)));
  const [mr] = await db
    .select({ revenue: sql<number>`coalesce(sum(${salesEvents.valueCents}), 0)::bigint`, sales: sql<number>`count(*)::int` })
    .from(salesEvents)
    .where(and(eq(salesEvents.orgId, ctx.orgId), isNull(salesEvents.voidedAt), eq(salesEvents.type, "sale_won"), gte(salesEvents.occurredAt, gm.start), lt(salesEvents.occurredAt, gm.end)));
  const realized = Number(mr.revenue);
  const now = Date.now();
  const totalDays = Math.round((gm.end.getTime() - gm.start.getTime()) / 86400000);
  const elapsedDays = Math.min(totalDays, Math.max(0, (now - gm.start.getTime()) / 86400000));
  const isCurrent = now >= gm.start.getTime() && now < gm.end.getTime();
  const target = goal ? Number(goal.targetCents) : 0;
  const meta = {
    month: goalMonth,
    targetCents: target,
    realizedCents: realized,
    remainingCents: Math.max(0, target - realized),
    progress: target ? Math.round((realized / target) * 1000) / 10 : null,
    sales: mr.sales,
    daysLeft: isCurrent ? Math.max(0, Math.ceil(totalDays - elapsedDays)) : 0,
    /** Projeção no ritmo atual (só no mês corrente, a partir do 7º dia, para não exagerar no começo do mês). */
    forecastCents: isCurrent && elapsedDays >= 7 ? Math.round((realized / elapsedDays) * totalDays) : null,
    canEdit: ctx.role === "admin",
  };

  const conversions = {
    contactToMeeting: pct(kpis.scheduled, kpis.contacts),
    meetingToShow: pct(kpis.done, kpis.scheduled),
    meetingToSale: pct(kpis.sales, kpis.done),
    contactToSale: pct(kpis.sales, kpis.contacts),
  };

  const isManager = can(ctx, "data.all");
  // Rankings: gestores veem todos.
  let closerRanking: { userId: string; name: string; sales: number; revenueCents: number; avgTicketCents: number }[] = [];
  let schedulerRanking: { userId: string; name: string; role: string | null; scheduled: number; done: number; sold: number }[] = [];
  if (isManager) {
    const cr = await db
      .select({ userId: salesEvents.closerId, sales: sql<number>`count(*)::int`, revenue: sql<number>`coalesce(sum(${salesEvents.valueCents}), 0)::bigint` })
      .from(salesEvents)
      .where(and(...conds, eq(salesEvents.type, "sale_won"), sql`${salesEvents.closerId} is not null`))
      .groupBy(salesEvents.closerId)
      .orderBy(sql`3 desc`)
      .limit(20);
    const sr = await db
      .select({
        userId: salesEvents.actorId,
        scheduled: sql<number>`count(*)::int`,
        // Referências qualificadas de propósito: sem join, o Drizzle omitiria o nome da tabela e a subconsulta compararia consigo mesma.
        done: sql<number>`count(*) filter (where exists (select 1 from sales_events d where d.appointment_id = ${OUTER.appointment} and d.type = 'meeting_done' and d.voided_at is null))::int`,
        sold: sql<number>`count(distinct ${salesEvents.contactId}) filter (where exists (select 1 from sales_events s where s.contact_id = ${OUTER.contact} and s.type = 'sale_won' and s.voided_at is null and s.occurred_at >= ${OUTER.at}))::int`,
      })
      .from(salesEvents)
      .where(and(...conds, eq(salesEvents.type, "meeting_scheduled"), sql`${salesEvents.actorId} is not null`))
      .groupBy(salesEvents.actorId)
      .orderBy(sql`2 desc`)
      .limit(20);
    const people = await db
      .select({ id: users.id, name: users.name, role: memberships.role })
      .from(users)
      .leftJoin(memberships, and(eq(memberships.userId, users.id), eq(memberships.orgId, ctx.orgId)))
      .where(inArray(users.id, [...cr.map((r) => r.userId), ...sr.map((r) => r.userId), ctx.userId].filter((x): x is string => !!x)));
    const who = (id: string | null) => people.find((p) => p.id === id);
    closerRanking = cr.map((r) => ({ userId: r.userId!, name: who(r.userId)?.name ?? "—", sales: r.sales, revenueCents: Number(r.revenue), avgTicketCents: r.sales ? Math.round(Number(r.revenue) / r.sales) : 0 }));
    schedulerRanking = sr.map((r) => ({ userId: r.userId!, name: who(r.userId)?.name ?? "—", role: who(r.userId)?.role ?? null, scheduled: r.scheduled, done: r.done, sold: r.sold }));
  }

  // Origem dos leads: pessoas que chegaram no período (primeira origem), e o que cada origem gerou.
  const leadConds: SQL[] = [eq(contacts.orgId, ctx.orgId), gte(contacts.firstTouchAt, start), lt(contacts.firstTouchAt, end), isNull(contacts.mergedIntoId)];
  if (!isManager) {
    if (ctx.role === "seller") leadConds.push(eq(contacts.ownerId, ctx.userId));
    else leadConds.push(sql`exists (select 1 from opportunities o where o.contact_id = ${OUTER_CONTACT} and o.closer_id = ${ctx.userId})`);
  } else if (f.sellerId) leadConds.push(eq(contacts.ownerId, f.sellerId));
  if (isManager && f.closerId) leadConds.push(sql`exists (select 1 from opportunities o where o.contact_id = ${OUTER_CONTACT} and o.closer_id = ${f.closerId})`);
  if (f.sourceId) leadConds.push(eq(contacts.firstSourceId, f.sourceId));
  if (f.campaign) leadConds.push(sql`exists (select 1 from ${leads} l where l.contact_id = ${OUTER_CONTACT} and l.campaign = ${f.campaign})`);
  if (f.productId) leadConds.push(sql`exists (select 1 from ${leads} l where l.contact_id = ${OUTER_CONTACT} and l.product_id = ${f.productId})`);
  const [leadRows, eventRows, sources] = await Promise.all([
    db.select({ sourceId: contacts.firstSourceId, n: sql<number>`count(*)::int` }).from(contacts).where(and(...leadConds)).groupBy(contacts.firstSourceId),
    db
      .select({
        sourceId: salesEvents.sourceId,
        meetings: sql<number>`count(*) filter (where ${salesEvents.type} = 'meeting_scheduled')::int`,
        sales: sql<number>`count(*) filter (where ${salesEvents.type} = 'sale_won')::int`,
        revenue: sql<number>`coalesce(sum(${salesEvents.valueCents}) filter (where ${salesEvents.type} = 'sale_won'), 0)::bigint`,
      })
      .from(salesEvents)
      .where(and(...conds))
      .groupBy(salesEvents.sourceId),
    db.select({ id: leadSources.id, name: leadSources.name, color: leadSources.color, position: leadSources.position }).from(leadSources).where(eq(leadSources.orgId, ctx.orgId)).orderBy(asc(leadSources.position)),
  ]);
  const totalLeads = leadRows.reduce((a, r) => a + r.n, 0);
  const keys = new Set<string | null>([...leadRows.map((r) => r.sourceId), ...eventRows.map((r) => r.sourceId)]);
  const origins = [...keys]
    .map((id) => {
      const s = sources.find((x) => x.id === id);
      const l = leadRows.find((r) => r.sourceId === id);
      const e = eventRows.find((r) => r.sourceId === id);
      return {
        sourceId: id,
        name: s?.name ?? "Sem origem",
        color: s?.color ?? "gray",
        leads: l?.n ?? 0,
        share: totalLeads ? Math.round(((l?.n ?? 0) / totalLeads) * 1000) / 10 : 0,
        meetings: e?.meetings ?? 0,
        sales: e?.sales ?? 0,
        revenueCents: Number(e?.revenue ?? 0),
      };
    })
    .filter((o) => o.leads || o.meetings || o.sales)
    .sort((a, b) => b.leads - a.leads || b.revenueCents - a.revenueCents);

  return {
    period: { key: f.period, start, end },
    scope: isManager ? "org" : ctx.role,
    meta,
    kpis,
    conversions,
    closerRanking,
    schedulerRanking,
    origins: { totalLeads, rows: origins },
  };
}

/** Opções dos filtros do Dashboard (gestores). */
export async function dashboardOptions(ctx: Ctx) {
  const [people, prods, sources, campaigns] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(and(eq(memberships.orgId, ctx.orgId), sql`${memberships.status} <> 'pending'`))
      .orderBy(asc(users.name)),
    db.select({ id: products.id, name: products.name }).from(products).where(and(eq(products.orgId, ctx.orgId), isNull(products.archivedAt))).orderBy(asc(products.name)),
    db.select({ id: leadSources.id, name: leadSources.name, color: leadSources.color }).from(leadSources).where(and(eq(leadSources.orgId, ctx.orgId), isNull(leadSources.archivedAt))).orderBy(asc(leadSources.position)),
    db.selectDistinct({ campaign: salesEvents.campaign }).from(salesEvents).where(and(eq(salesEvents.orgId, ctx.orgId), sql`${salesEvents.campaign} is not null`)).limit(200),
  ]);
  return {
    sellers: people.filter((p) => p.role === "seller"),
    closers: people.filter((p) => p.role === "closer" || p.role === "manager" || p.role === "admin"),
    products: prods,
    sources,
    campaigns: campaigns.map((c) => c.campaign!).sort((a, b) => a.localeCompare(b, "pt-BR")),
  };
}

// ---------- Meta comercial ----------
export const goalSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido."),
  targetCents: z.coerce.number().int().min(0).max(1_000_000_000_00),
});

export async function setGoal(ctx: Ctx, input: z.infer<typeof goalSchema>) {
  assertCan(ctx, "org.settings", "Somente o administrador define a meta comercial.");
  const [g] = await db
    .insert(salesGoals)
    .values({ orgId: ctx.orgId, month: input.month, targetCents: input.targetCents, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: [salesGoals.orgId, salesGoals.month], set: { targetCents: input.targetCents, updatedBy: ctx.userId, updatedAt: new Date() } })
    .returning();
  await audit(db, ctx, "goal.set", "sales_goal", g.id, { month: input.month, targetCents: input.targetCents });
  await publish({ orgId: ctx.orgId, topic: "opportunities" });
  return g;
}

export async function listGoals(ctx: Ctx) {
  const current = monthKey(new Date(), ctx.org.timezone);
  const rows = await db.select({ month: salesGoals.month, targetCents: salesGoals.targetCents }).from(salesGoals).where(eq(salesGoals.orgId, ctx.orgId)).orderBy(asc(salesGoals.month));
  const months = [-1, 0, 1, 2].map((d) => monthKey(addMonths(startOfMonth(new TZDate(Date.now(), ctx.org.timezone)), d), ctx.org.timezone));
  return { current, months: months.map((m) => ({ month: m, targetCents: Number(rows.find((r) => r.month === m)?.targetCents ?? 0) })) };
}
