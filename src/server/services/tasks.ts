import { and, asc, desc, eq, gte, inArray, lt, lte, gt, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { contacts, memberships, opportunities, taskChecklistItems, taskLinks, tasks, users } from "../db/schema";
import type { Ctx } from "../context";
import { can, contactScope, opportunityScope, taskScope } from "../permissions";
import { forbidden, invalid, notFound } from "../errors";
import { publish } from "../realtime";
import { audit, cleanText, notifyUser } from "./common";
import { assertMember } from "./team";
import { dayRange, tsz } from "../time";
import { logger } from "../logger";

export const taskViewSchema = z.enum(["today", "overdue", "upcoming", "done", "open", "all"]);
export const prioritySchema = z.enum(["low", "medium", "high"]);
const statusSchema = z.enum(["open", "in_progress", "done"]);

export const listTasksSchema = z.object({
  view: taskViewSchema.default("today"),
  ownerId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  priority: prioritySchema.optional(),
  status: z.enum(["open", "in_progress"]).optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const notDone = ne(tasks.status, "done");

async function contactVisible(ctx: Ctx, contactId: string) {
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  return !!c;
}

export async function listTasks(ctx: Ctx, f: Partial<z.infer<typeof listTasksSchema>>) {
  const view = f.view ?? "today";
  const { start, end } = dayRange(new Date(), ctx.org.timezone);
  const conds: SQL[] = [];
  // Na página do lead aparecem todas as tarefas dele (para quem vê o lead), não só as próprias.
  if (f.contactId && (await contactVisible(ctx, f.contactId))) conds.push(eq(tasks.orgId, ctx.orgId), eq(tasks.contactId, f.contactId));
  else {
    conds.push(taskScope(ctx));
    if (f.contactId) conds.push(eq(tasks.contactId, f.contactId));
  }
  if (view === "done") conds.push(eq(tasks.status, "done"));
  else if (view !== "all") conds.push(notDone);
  if (view === "today") conds.push(and(gte(tasks.dueAt, start), lt(tasks.dueAt, end))!);
  if (view === "overdue") conds.push(lt(tasks.dueAt, start));
  if (view === "upcoming") conds.push(sql`(${tasks.dueAt} >= ${tsz(end)} or ${tasks.dueAt} is null)`);
  if (f.ownerId) {
    if (!can(ctx, "data.all") && f.ownerId !== ctx.userId) throw forbidden();
    conds.push(eq(tasks.ownerId, f.ownerId));
  }
  if (f.priority) conds.push(eq(tasks.priority, f.priority));
  if (f.status) conds.push(eq(tasks.status, f.status));
  if (f.q) conds.push(sql`(${tasks.title} ilike ${"%" + f.q + "%"} or ${contacts.name} ilike ${"%" + f.q + "%"})`);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      notes: tasks.notes,
      dueAt: tasks.dueAt,
      status: tasks.status,
      priority: tasks.priority,
      completedAt: tasks.completedAt,
      ownerId: tasks.ownerId,
      ownerName: users.name,
      createdBy: tasks.createdBy,
      contactId: tasks.contactId,
      contactName: contacts.name,
      opportunityId: tasks.opportunityId,
      opportunityTitle: opportunities.title,
      checklistTotal: sql<number>`(select count(*)::int from ${taskChecklistItems} i where i.task_id = ${tasks.id})`,
      checklistDone: sql<number>`(select count(*)::int from ${taskChecklistItems} i where i.task_id = ${tasks.id} and i.done)`,
      linkCount: sql<number>`(select count(*)::int from ${taskLinks} l where l.task_id = ${tasks.id})`,
    })
    .from(tasks)
    .leftJoin(users, eq(users.id, tasks.ownerId))
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .leftJoin(opportunities, eq(opportunities.id, tasks.opportunityId))
    .where(and(...conds))
    .orderBy(
      view === "done" ? desc(tasks.completedAt) : asc(sql`coalesce(${tasks.dueAt}, 'infinity'::timestamptz)`),
      sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 else 2 end`,
    )
    .limit(f.limit ?? 50);
  return rows;
}

export async function taskCounts(ctx: Ctx) {
  const { start, end } = dayRange(new Date(), ctx.org.timezone);
  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${tasks.dueAt} >= ${tsz(start)} and ${tasks.dueAt} < ${tsz(end)})::int`,
      overdue: sql<number>`count(*) filter (where ${tasks.dueAt} < ${tsz(start)})::int`,
      upcoming: sql<number>`count(*) filter (where ${tasks.dueAt} >= ${tsz(end)} or ${tasks.dueAt} is null)::int`,
      inProgress: sql<number>`count(*) filter (where ${tasks.status} = 'in_progress')::int`,
    })
    .from(tasks)
    .where(and(taskScope(ctx), notDone));
  return row;
}

const checklistInput = z.array(z.string().trim().min(1).max(200)).max(50);
const linkSchema = z.object({
  title: z.string().trim().min(1, "Dê um nome ao material.").max(120),
  url: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`))
    .refine((v) => {
      try {
        return ["http:", "https:"].includes(new URL(v).protocol);
      } catch {
        return false;
      }
    }, "Link inválido."),
  description: z.string().trim().max(300).nullish(),
});

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "Informe o título.").max(160),
  notes: z.string().max(5000).nullish(),
  dueAt: z.coerce.date().nullish(),
  ownerId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  opportunityId: z.string().uuid().nullish(),
  priority: prioritySchema.optional(),
  status: statusSchema.optional(),
  checklist: checklistInput.optional(),
  links: z.array(linkSchema).max(30).optional(),
});

async function validateLinks(ctx: Ctx, input: { contactId?: string | null; opportunityId?: string | null; ownerId?: string | null }) {
  if (input.contactId) {
    if (!(await contactVisible(ctx, input.contactId))) throw invalid("Contato inválido.");
  }
  if (input.opportunityId) {
    const [o] = await db.select({ id: opportunities.id }).from(opportunities).where(and(eq(opportunities.id, input.opportunityId), opportunityScope(ctx)));
    if (!o) throw invalid("Oportunidade inválida.");
  }
  // Qualquer pessoa da equipe pode atribuir uma tarefa a outra (ex.: social seller → closer).
  if (input.ownerId) await assertMember(ctx.orgId, input.ownerId, { activeOnly: true });
}

const firstName = (n: string) => n.split(" ")[0];

export async function createTask(ctx: Ctx, input: z.infer<typeof taskInputSchema>) {
  const ownerId = input.ownerId ?? ctx.userId;
  await validateLinks(ctx, { ...input, ownerId });
  const t = await db.transaction(async (tx) => {
    const [t] = await tx
      .insert(tasks)
      .values({
        orgId: ctx.orgId,
        title: input.title,
        notes: cleanText(input.notes, 5000),
        dueAt: input.dueAt ?? null,
        ownerId,
        contactId: input.contactId ?? null,
        opportunityId: input.opportunityId ?? null,
        priority: input.priority ?? "medium",
        status: input.status === "done" ? "done" : (input.status ?? "open"),
        completedAt: input.status === "done" ? new Date() : null,
        createdBy: ctx.userId,
      })
      .returning();
    if (input.checklist?.length) await tx.insert(taskChecklistItems).values(input.checklist.map((text, i) => ({ orgId: ctx.orgId, taskId: t.id, text, position: i })));
    if (input.links?.length) {
      const parsed = input.links.map((l) => linkSchema.parse(l));
      await tx.insert(taskLinks).values(parsed.map((l, i) => ({ orgId: ctx.orgId, taskId: t.id, title: l.title, url: l.url, description: cleanText(l.description, 300), position: i, createdBy: ctx.userId })));
    }
    return t;
  });
  if (ownerId !== ctx.userId) {
    await notifyUser({
      orgId: ctx.orgId,
      userId: ownerId,
      type: "task.assigned",
      title: `Nova tarefa: ${t.title}`,
      body: `${firstName(ctx.userName)} atribuiu uma nova tarefa para você.`,
      link: `/tarefas?tarefa=${t.id}`,
    });
  }
  await publish({ orgId: ctx.orgId, topic: "tasks", entityId: t.id, ownerIds: [ownerId, ctx.userId] });
  return t;
}

async function getVisibleTask(ctx: Ctx, id: string) {
  const [t] = await db.select().from(tasks).where(and(eq(tasks.id, id), taskScope(ctx)));
  if (t) return t;
  // Quem vê o lead também abre as tarefas dele (somente leitura para quem não é responsável nem autor).
  const [x] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.orgId, ctx.orgId)));
  if (x?.contactId && (await contactVisible(ctx, x.contactId))) return x;
  throw notFound("Tarefa não encontrada.");
}

function canEdit(ctx: Ctx, t: typeof tasks.$inferSelect) {
  return can(ctx, "data.all") || t.ownerId === ctx.userId || t.createdBy === ctx.userId;
}
function assertEdit(ctx: Ctx, t: typeof tasks.$inferSelect) {
  if (!canEdit(ctx, t)) throw forbidden("Somente o responsável, quem criou a tarefa ou um gestor pode alterá-la.");
}

/** Tarefa completa: checklist, materiais, lead e responsável. */
export async function getTask(ctx: Ctx, id: string) {
  const t = await getVisibleTask(ctx, id);
  const ids = [t.ownerId, t.createdBy].filter((x): x is string => !!x);
  const names = ids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)) : [];
  const [contact] = t.contactId ? await db.select({ id: contacts.id, name: contacts.name, avatarUrl: contacts.avatarUrl, username: contacts.username }).from(contacts).where(eq(contacts.id, t.contactId)) : [];
  const [checklist, links] = await Promise.all([
    db.select().from(taskChecklistItems).where(eq(taskChecklistItems.taskId, t.id)).orderBy(asc(taskChecklistItems.position), asc(taskChecklistItems.createdAt)),
    db.select().from(taskLinks).where(eq(taskLinks.taskId, t.id)).orderBy(asc(taskLinks.position), asc(taskLinks.createdAt)),
  ]);
  return {
    ...t,
    ownerName: names.find((n) => n.id === t.ownerId)?.name ?? null,
    createdByName: names.find((n) => n.id === t.createdBy)?.name ?? null,
    contact: contact ?? null,
    checklist,
    links,
    canEdit: canEdit(ctx, t),
  };
}

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
  notes: z.string().max(5000).nullish(),
  dueAt: z.coerce.date().nullish(),
  ownerId: z.string().uuid().nullish(),
  contactId: z.string().uuid().nullish(),
  opportunityId: z.string().uuid().nullish(),
  priority: prioritySchema.optional(),
  status: statusSchema.optional(),
});

export async function updateTask(ctx: Ctx, id: string, input: z.infer<typeof updateTaskSchema>) {
  const t = await getVisibleTask(ctx, id);
  assertEdit(ctx, t);
  await validateLinks(ctx, { contactId: input.contactId, opportunityId: input.opportunityId, ownerId: input.ownerId && input.ownerId !== t.ownerId ? input.ownerId : undefined });
  const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (input.title !== undefined) patch.title = input.title;
  if (input.notes !== undefined) patch.notes = cleanText(input.notes, 5000);
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt ?? null;
  if (input.ownerId !== undefined && input.ownerId) patch.ownerId = input.ownerId;
  if (input.contactId !== undefined) patch.contactId = input.contactId ?? null;
  if (input.opportunityId !== undefined) patch.opportunityId = input.opportunityId ?? null;
  if (input.priority) patch.priority = input.priority;
  if (input.status && input.status !== t.status) {
    patch.status = input.status;
    patch.completedAt = input.status === "done" ? new Date() : null;
  }
  const [updated] = await db.update(tasks).set(patch).where(eq(tasks.id, t.id)).returning();
  if (patch.status) await audit(db, ctx, patch.status === "done" ? "task.completed" : patch.status === "in_progress" ? "task.started" : "task.reopened", "task", t.id);
  if (patch.ownerId && patch.ownerId !== t.ownerId && patch.ownerId !== ctx.userId) {
    await notifyUser({ orgId: ctx.orgId, userId: patch.ownerId, type: "task.assigned", title: `Nova tarefa: ${updated.title}`, body: `${firstName(ctx.userName)} atribuiu uma nova tarefa para você.`, link: `/tarefas?tarefa=${t.id}` });
  }
  await publish({ orgId: ctx.orgId, topic: "tasks", entityId: t.id, ownerIds: [t.ownerId, updated.ownerId, t.createdBy] });
  return updated;
}

export async function deleteTask(ctx: Ctx, id: string) {
  const t = await getVisibleTask(ctx, id);
  if (!can(ctx, "data.all") && t.createdBy !== ctx.userId) throw forbidden("Somente quem criou a tarefa pode excluí-la.");
  await db.delete(tasks).where(eq(tasks.id, t.id));
  await audit(db, ctx, "task.deleted", "task", t.id, { title: t.title });
  await publish({ orgId: ctx.orgId, topic: "tasks", ownerIds: [t.ownerId, t.createdBy] });
}

// ---------- Checklist ----------
export const checklistItemSchema = z.object({ text: z.string().trim().min(1, "Escreva o item.").max(200) });
export const checklistPatchSchema = z.object({ text: z.string().trim().min(1).max(200).optional(), done: z.boolean().optional() });

async function editableTask(ctx: Ctx, taskId: string) {
  const t = await getVisibleTask(ctx, taskId);
  assertEdit(ctx, t);
  return t;
}
async function touched(ctx: Ctx, t: typeof tasks.$inferSelect) {
  await db.update(tasks).set({ updatedAt: new Date() }).where(eq(tasks.id, t.id));
  await publish({ orgId: ctx.orgId, topic: "tasks", entityId: t.id, ownerIds: [t.ownerId, t.createdBy] });
}

export async function addChecklistItem(ctx: Ctx, taskId: string, input: z.infer<typeof checklistItemSchema>) {
  const t = await editableTask(ctx, taskId);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, t.id));
  if (n >= 100) throw invalid("Limite de 100 itens no checklist.");
  const [{ m }] = await db.select({ m: sql<number>`coalesce(max(${taskChecklistItems.position}), -1)::int` }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, t.id));
  const [item] = await db.insert(taskChecklistItems).values({ orgId: ctx.orgId, taskId: t.id, text: input.text, position: m + 1 }).returning();
  await touched(ctx, t);
  return item;
}

async function itemOf(ctx: Ctx, taskId: string, itemId: string) {
  const t = await editableTask(ctx, taskId);
  const [item] = await db.select().from(taskChecklistItems).where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, t.id)));
  if (!item) throw notFound("Item não encontrado.");
  return { t, item };
}

export async function updateChecklistItem(ctx: Ctx, taskId: string, itemId: string, input: z.infer<typeof checklistPatchSchema>) {
  const { t, item } = await itemOf(ctx, taskId, itemId);
  const patch: Partial<typeof taskChecklistItems.$inferInsert> = {};
  if (input.text !== undefined) patch.text = input.text;
  if (input.done !== undefined) {
    patch.done = input.done;
    patch.doneAt = input.done ? new Date() : null;
  }
  const [u] = await db.update(taskChecklistItems).set(patch).where(eq(taskChecklistItems.id, item.id)).returning();
  await touched(ctx, t);
  return u;
}

export async function deleteChecklistItem(ctx: Ctx, taskId: string, itemId: string) {
  const { t, item } = await itemOf(ctx, taskId, itemId);
  await db.delete(taskChecklistItems).where(eq(taskChecklistItems.id, item.id));
  await touched(ctx, t);
}

export async function reorderChecklist(ctx: Ctx, taskId: string, orderedIds: string[]) {
  const t = await editableTask(ctx, taskId);
  const items = await db.select({ id: taskChecklistItems.id }).from(taskChecklistItems).where(eq(taskChecklistItems.taskId, t.id));
  const ids = new Set(items.map((i) => i.id));
  if (orderedIds.length !== items.length || orderedIds.some((id) => !ids.has(id))) throw invalid("O checklist mudou. Recarregue e tente de novo.");
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedIds.entries()) await tx.update(taskChecklistItems).set({ position: i }).where(eq(taskChecklistItems.id, id));
  });
  await touched(ctx, t);
}

// ---------- Materiais ----------
export const taskLinkSchema = linkSchema;

export async function addTaskLink(ctx: Ctx, taskId: string, raw: z.input<typeof linkSchema>) {
  const input = linkSchema.parse(raw);
  const t = await editableTask(ctx, taskId);
  const [{ n, m }] = await db
    .select({ n: sql<number>`count(*)::int`, m: sql<number>`coalesce(max(${taskLinks.position}), -1)::int` })
    .from(taskLinks)
    .where(eq(taskLinks.taskId, t.id));
  if (n >= 30) throw invalid("Limite de 30 materiais por tarefa.");
  const [l] = await db.insert(taskLinks).values({ orgId: ctx.orgId, taskId: t.id, title: input.title, url: input.url, description: cleanText(input.description, 300), position: m + 1, createdBy: ctx.userId }).returning();
  await touched(ctx, t);
  return l;
}

export async function updateTaskLink(ctx: Ctx, taskId: string, linkId: string, raw: Partial<z.input<typeof linkSchema>>) {
  const input = linkSchema.partial().parse(raw);
  const t = await editableTask(ctx, taskId);
  const patch: Partial<typeof taskLinks.$inferInsert> = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.url !== undefined) patch.url = input.url;
  if (input.description !== undefined) patch.description = cleanText(input.description, 300);
  const [l] = await db.update(taskLinks).set(patch).where(and(eq(taskLinks.id, linkId), eq(taskLinks.taskId, t.id))).returning();
  if (!l) throw notFound("Material não encontrado.");
  await touched(ctx, t);
  return l;
}

export async function deleteTaskLink(ctx: Ctx, taskId: string, linkId: string) {
  const t = await editableTask(ctx, taskId);
  await db.delete(taskLinks).where(and(eq(taskLinks.id, linkId), eq(taskLinks.taskId, t.id)));
  await touched(ctx, t);
}

// ---------- Lembretes ----------
/**
 * Avisa o responsável 30 min antes do prazo e quando a tarefa atrasa — uma única vez cada
 * (a chave inclui o prazo: se ele mudar, avisa de novo). Tarefas atrasadas há muito tempo não geram aviso.
 */
export async function taskReminders(now = new Date()) {
  const soon = await db
    .select({ id: tasks.id, orgId: tasks.orgId, ownerId: tasks.ownerId, title: tasks.title, dueAt: tasks.dueAt, contactName: contacts.name })
    .from(tasks)
    .innerJoin(memberships, and(eq(memberships.orgId, tasks.orgId), eq(memberships.userId, tasks.ownerId), eq(memberships.status, "active")))
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .where(and(notDone, gt(tasks.dueAt, now), lte(tasks.dueAt, new Date(now.getTime() + 30 * 60_000))))
    .limit(500);
  const late = await db
    .select({ id: tasks.id, orgId: tasks.orgId, ownerId: tasks.ownerId, title: tasks.title, dueAt: tasks.dueAt, contactName: contacts.name })
    .from(tasks)
    .innerJoin(memberships, and(eq(memberships.orgId, tasks.orgId), eq(memberships.userId, tasks.ownerId), eq(memberships.status, "active")))
    .leftJoin(contacts, eq(contacts.id, tasks.contactId))
    .where(and(notDone, lte(tasks.dueAt, now), gt(tasks.dueAt, new Date(now.getTime() - 6 * 3600_000))))
    .limit(500);
  const label = (t: { title: string; contactName: string | null }) => (t.contactName ? `${t.title} com ${t.contactName.split(" ")[0]}` : t.title);
  let sent = 0;
  for (const t of soon) {
    const min = Math.max(1, Math.round((t.dueAt!.getTime() - now.getTime()) / 60_000));
    try {
      if (await notifyUser({ orgId: t.orgId, userId: t.ownerId!, type: "task.due_soon", title: "⏰ Tarefa próxima do prazo", body: `Faltam ${min} minutos para ${label(t)}.`, link: `/tarefas?tarefa=${t.id}`, dedupeKey: `task:${t.id}:soon:${t.dueAt!.getTime()}` })) sent++;
    } catch (e) {
      logger.warn("Falha no lembrete de tarefa", e);
    }
  }
  for (const t of late) {
    try {
      if (await notifyUser({ orgId: t.orgId, userId: t.ownerId!, type: "task.overdue", title: "Tarefa atrasada", body: `${label(t)} está atrasada.`, link: `/tarefas?tarefa=${t.id}`, dedupeKey: `task:${t.id}:overdue:${t.dueAt!.getTime()}` })) sent++;
    } catch (e) {
      logger.warn("Falha no aviso de tarefa atrasada", e);
    }
  }
  return sent;
}
