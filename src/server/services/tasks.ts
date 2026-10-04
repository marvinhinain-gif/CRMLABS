import { and, asc, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contacts, opportunities, tasks, users } from "../db/schema";
import type { Ctx } from "../context";
import { can, contactScope, opportunityScope, taskScope } from "../permissions";
import { forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, cleanText, notifyUser } from "./common";
import { assertMember } from "./team";
import { dayRange, tsz } from "../time";

export const taskViewSchema = z.enum(["today", "overdue", "upcoming", "done", "open"]);

export const listTasksSchema = z.object({
  view: taskViewSchema.default("today"),
  ownerId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function listTasks(ctx: Ctx, f: z.infer<typeof listTasksSchema>) {
  const { start, end } = dayRange(new Date(), ctx.org.timezone);
  const conds: SQL[] = [taskScope(ctx)];
  if (f.view === "done") conds.push(eq(tasks.status, "done"));
  else conds.push(eq(tasks.status, "open"));
  if (f.view === "today") conds.push(and(gte(tasks.dueAt, start), lt(tasks.dueAt, end))!);
  if (f.view === "overdue") conds.push(lt(tasks.dueAt, start));
  if (f.view === "upcoming") conds.push(sql`(${tasks.dueAt} >= ${tsz(end)} or ${tasks.dueAt} is null)`);
  if (f.ownerId) {
    if (!can(ctx, "data.all") && f.ownerId !== ctx.userId) throw forbidden();
    conds.push(eq(tasks.ownerId, f.ownerId));
  }
  if (f.contactId) conds.push(eq(tasks.contactId, f.contactId));
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      notes: tasks.notes,
      dueAt: tasks.dueAt,
      status: tasks.status,
      completedAt: tasks.completedAt,
      ownerId: tasks.ownerId,
      ownerName: users.name,
      contactId: tasks.contactId,
      contactName: contacts.name,
      opportunityId: tasks.opportunityId,
      opportunityTitle: opportunities.title,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.ownerId))
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(opportunities, eq(opportunities.id, tasks.opportunityId))
    .where(and(...conds))
    .orderBy(f.view === "done" ? desc(tasks.completedAt) : asc(sql`coalesce(${tasks.dueAt}, 'infinity'::timestamptz)`))
    .limit(f.limit);
  return rows;
}

export async function taskCounts(ctx: Ctx) {
  const { start, end } = dayRange(new Date(), ctx.org.timezone);
  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${tasks.dueAt} >= ${tsz(start)} and ${tasks.dueAt} < ${tsz(end)})::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < ${tsz(start)})::int`,
    })
    .from(tasks)
    .where(and(taskScope(ctx), eq(tasks.status, "open")));
  return row;
}

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(160),
  notes: z.string().max(2000).nullish(),
  dueAt: z.coerce.date().nullish(),
  ownerId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  opportunityId: z.string().uuid().nullish(),
});

async function validateLinks(ctx: Ctx, input: { contactId?: string | null; opportunityId?: string | null; ownerId?: string | null }) {
  if (input.contactId) {
    const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, input.contactId), contactScope(ctx)));
    if (!c) throw invalid("Contato inválido.");
  }
  if (input.opportunityId) {
    const [o] = await db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.id, input.opportunityId), opportunityScope(ctx)));
    if (!o) throw invalid("Oportunidade inválida.");
  }
  if (input.ownerId) {
    if (!can(ctx, "contacts.assign") && input.ownerId !== ctx.userId) {
      throw forbidden("Somente administradores e gestores atribuem tarefas a outras pessoas.");
    }
    await assertMember(ctx.orgId, input.ownerId, { activeOnly: true });
  }
}

export async function createTask(ctx: Ctx, input: z.infer<typeof taskInputSchema>) {
  const ownerId = input.ownerId ?? ctx.userId;
  await validateLinks(ctx, { ...input, ownerId });
  const [t] = await db
    .insert(tasks)
    .values({
      orgId: ctx.orgId,
      title: input.title,
      notes: cleanText(input.notes),
      dueAt: input.dueAt ?? null,
      ownerId,
      contactId: input.contactId ?? null,
      opportunityId: input.opportunityId ?? null,
      createdBy: ctx.userId,
    })
    .returning();
  if (ownerId !== ctx.userId) {
    await notifyUser({
      orgId: ctx.orgId,
      userId: ownerId,
      type: "task.assigned",
      title: `Nova tarefa: ${t.title}`,
      body: `${ctx.userName} atribuiu uma tarefa a você.`,
      link: t.contactId ? `/tarefas?contato=${t.contactId}` : "/tarefas",
    });
  }
  await publish({ orgId: ctx.orgId, topic: "tasks", entityId: t.id, ownerIds: [ownerId] });
  return t;
}

async function getVisibleTask(ctx: Ctx, id: string) {
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, id), taskScope(ctx)));
  if (!t) throw notFound("Tarefa não encontrada.");
  return t;
}

export const updateTaskSchema = taskInputSchema.partial().extend({ status: z.enum(["open", "done"]).optional() });

export async function updateTask(ctx: Ctx, id: string, input: z.infer<typeof updateTaskSchema>) {
  const t = await getVisibleTask(ctx, id);
  await validateLinks(ctx, { contactId: input.contactId, opportunityId: input.opportunityId, ownerId: input.ownerId && input.ownerId !== t.ownerId ? input.ownerId : undefined });
  const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = cleanText(input.notes);
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt ?? null;
  if (input.ownerId !== undefined && input.ownerId) patch.ownerId = input.ownerId;
  if (input.contactId !== undefined) patch.contactId = input.contactId ?? null;
  if (input.opportunityId !== undefined) patch.opportunityId = input.opportunityId ?? null;
  if (input.status === "done" && t.status !== "done") {
    patch.status = "done";
    patch.completedAt = new Date();
  }
  if (input.status === "open" && t.status === "done") {
    patch.status = "open";
    patch.completedAt = null;
  }
  const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, t.id)).returning();
  if (patch.status) await audit(db, ctx, patch.status === "done" ? "task.completed" : "task.reopened", "task", t.id);
  if (patch.ownerId && patch.ownerId !== t.ownerId && patch.ownerId !== ctx.userId) {
    await notifyUser({ orgId: ctx.orgId, userId: patch.ownerId, type: "task.assigned", title: `Tarefa atribuída: ${updated.title}`, link: "/tarefas" });
  }
  await publish({ orgId: ctx.orgId, topic: "tasks", entityId: t.id, ownerIds: [t.ownerId, updated.ownerId] });
  return updated;
}

export async function deleteTask(ctx: Ctx, id: string) {
  const t = await getVisibleTask(ctx, id);
  if (!can(ctx, "data.all") && t.createdBy !== ctx.userId) throw forbidden("Somente quem criou a tarefa pode excluí-la.");
  await db.delete(tasks).where(eq(tasks.id, t.id));
  await audit(db, ctx, "task.deleted", "task", t.id, { title: t.title });
  await publish({ orgId: ctx.orgId, topic: "tasks", ownerIds: [t.ownerId] });
}

