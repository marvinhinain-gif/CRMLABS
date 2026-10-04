import { and, desc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  appointments,
  contacts,
  conversations,
  messages,
  opportunities,
  pipelineStages,
  relationshipEntries,
  stageHistory,
  users,
} from "../db/schema";
import type { Ctx } from "../context";
import { appointmentScope, can, contactScope, conversationScope, opportunityScope } from "../permissions";
import { forbidden } from "../errors";
import { periodRange, tsz, type PeriodKey } from "../time";
import { getPipeline, NOVO_INTERESSADO_KEY } from "./common";
import { listTasks, taskCounts } from "./tasks";

export const dashboardSchema = z.object({
  period: z.enum(["today", "7d", "30d", "month", "last_month"]).default("month"),
  ownerId: z.string().uuid().optional(),
});

export async function getDashboard(ctx: Ctx, input: z.infer<typeof dashboardSchema>) {
  if (input.ownerId && !can(ctx, "data.all") && input.ownerId !== ctx.userId) throw forbidden();
  const { start, end } = periodRange(input.period as PeriodKey, ctx.org.timezone);
  const owner = input.ownerId;
  const rel = await getPipeline(ctx.orgId, "relationship");

  // Novos interessados: contatos distintos cuja PRIMEIRA entrada em "Novo interessado" ocorreu no período.
  const novoStages = db
    .select({ id: pipelineStages.id })
    .from(pipelineStages)
    .where(and(eq(pipelineStages.pipelineId, rel.id), eq(pipelineStages.key, NOVO_INTERESSADO_KEY)));
  const firstEntries = db
    .select({
      contactId: stageHistory.contactId,
      firstAt: sql<Date>`min(${stageHistory.createdAt})`.as("first_at"),
    })
    .from(stageHistory)
    .where(and(eq(stageHistory.orgId, ctx.orgId), eq(stageHistory.entityType, "relationship"), inArray(stageHistory.toStageId, novoStages)))
    .groupBy(stageHistory.contactId)
    .as("fe");
  const novosConds: SQL[] = [contactScope(ctx), sql`${firstEntries.firstAt} >= ${tsz(start)}`, sql`${firstEntries.firstAt} < ${tsz(end)}`];
  if (owner) novosConds.push(eq(contacts.ownerId, owner));

  const convConds: SQL[] = [
    conversationScope(ctx),
    eq(conversations.status, "open"),
    sql`exists (select 1 from ${messages} m where m.conversation_id = ${conversations.id} and m.sent_at >= ${tsz(start)} and m.sent_at < ${tsz(end)})`,
  ];
  if (owner) convConds.push(eq(conversations.ownerId, owner));

  const apptConds: SQL[] = [appointmentScope(ctx), ne(appointments.status, "canceled"), gte(appointments.startsAt, start), lt(appointments.startsAt, end)];
  if (owner) apptConds.push(eq(appointments.ownerId, owner));

  const salesConds: SQL[] = [opportunityScope(ctx), eq(opportunities.status, "won"), gte(opportunities.closedAt, start), lt(opportunities.closedAt, end)];
  if (owner) salesConds.push(eq(opportunities.closerId, owner));

  const distConds: SQL[] = [contactScope(ctx), isNull(relationshipEntries.closedAt), isNull(contacts.archivedAt)];
  if (owner) distConds.push(eq(contacts.ownerId, owner));

  const [[novos], [ativas], [reunioes], [vendas], distribution, awaiting] = await Promise.all([
    db.select({ n: sql<number>`count(distinct ${firstEntries.contactId})::int` }).from(firstEntries).innerJoin(contacts, eq(contacts.id, firstEntries.contactId)).where(and(...novosConds)),
    db.select({ n: sql<number>`count(*)::int` }).from(conversations).innerJoin(contacts, eq(contacts.id, conversations.contactId)).where(and(...convConds)),
    db.select({ n: sql<number>`count(*)::int` }).from(appointments).where(and(...apptConds)),
    db.select({ total: sql<number>`coalesce(sum(${opportunities.valueCents}), 0)::bigint`, n: sql<number>`count(*)::int` }).from(opportunities).where(and(...salesConds)),
    db
      .select({ stageId: pipelineStages.id, name: pipelineStages.name, color: pipelineStages.color, position: pipelineStages.position, n: sql<number>`count(${contacts.id})::int` })
      .from(pipelineStages)
      .leftJoin(
        relationshipEntries,
        and(eq(relationshipEntries.stageId, pipelineStages.id), isNull(relationshipEntries.closedAt)),
      )
      .leftJoin(contacts, and(eq(contacts.id, relationshipEntries.contactId), ...distConds))
      .where(and(eq(pipelineStages.pipelineId, rel.id), isNull(pipelineStages.archivedAt)))
      .groupBy(pipelineStages.id)
      .orderBy(pipelineStages.position),
    db
      .select({
        conversationId: conversations.id,
        contactId: contacts.id,
        contactName: contacts.name,
        avatarUrl: contacts.avatarUrl,
        channel: conversations.channel,
        preview: conversations.lastMessagePreview,
        lastMessageAt: conversations.lastMessageAt,
        ownerName: users.name,
        stageName: sql<string | null>`(select ps.name from ${relationshipEntries} re join ${pipelineStages} ps on ps.id = re.stage_id where re.contact_id = ${contacts.id} and re.closed_at is null limit 1)`,
        stageColor: sql<string | null>`(select ps.color from ${relationshipEntries} re join ${pipelineStages} ps on ps.id = re.stage_id where re.contact_id = ${contacts.id} and re.closed_at is null limit 1)`,
      })
      .from(conversations)
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .leftJoin(users, eq(users.id, conversations.ownerId))
      .where(and(conversationScope(ctx), eq(conversations.status, "open"), eq(conversations.lastMessageDirection, "in"), owner ? eq(conversations.ownerId, owner) : undefined))
      .orderBy(desc(conversations.lastMessageAt))
      .limit(5),
  ]);

  const [todayTasks, overdueTasks, counts] = await Promise.all([
    listTasks(ctx, { view: "today", limit: 5, ownerId: owner }),
    listTasks(ctx, { view: "overdue", limit: 5, ownerId: owner }),
    taskCounts(ctx),
  ]);

  return {
    period: { key: input.period, start, end },
    metrics: {
      novosInteressados: novos?.n ?? 0,
      conversasAtivas: ativas?.n ?? 0,
      reunioesAgendadas: reunioes?.n ?? 0,
      vendasFechadasCents: Number(vendas?.total ?? 0),
      vendasFechadasCount: vendas?.n ?? 0,
    },
    /** Fotografia atual, sem filtro de período. */
    distribution,
    tasks: { today: todayTasks, overdue: overdueTasks, counts },
    awaiting,
    isDemo: ctx.org.isDemo,
  };
}
