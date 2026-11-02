import { and, desc, eq, gte, isNotNull, like, lt, max, notLike, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditEvents, memberships, sessions, users, userAvatars } from "../db/schema";
import type { Ctx } from "../context";
import { assertCan } from "../permissions";
import { periodRange, type PeriodKey } from "../time";
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_PREFIXES, type ActivityCategory } from "@/lib/activity";
import { avatarUrl } from "./avatars";

/**
 * Histórico de acessos e atividades da equipe (Configurações → Atividade da equipe).
 * Só administradores: mostra IP e aparelho de cada acesso e tudo o que cada pessoa fez.
 * Lê a tabela audit_events, onde ficam os acessos (auth.*) e as ações no CRM.
 */

const PERIODS = ["today", "7d", "30d", "month", "last_month"] as const satisfies readonly PeriodKey[];
const PAGE = 50;

export const activityQuerySchema = z.object({
  pessoa: z.string().uuid().optional(),
  periodo: z.enum(PERIODS).default("7d"),
  tipo: z.enum(ACTIVITY_CATEGORIES).optional(),
  /** Cursor estável "data ISO com microssegundos|id" do último item da página anterior. */
  cursor: z.string().max(100).optional(),
});
export type ActivityQuery = z.infer<typeof activityQuerySchema>;

/** Condição SQL da categoria (mesmos prefixos usados para rotular no cliente). */
function categoryCondition(cat: ActivityCategory): SQL {
  const own = ACTIVITY_CATEGORY_PREFIXES.find(([c]) => c === cat)![1];
  // Prefixos que vêm antes na lista ganham (ex.: "instagram.lead_" é de Leads, não de Instagram).
  const earlier = ACTIVITY_CATEGORY_PREFIXES.slice(0, ACTIVITY_CATEGORY_PREFIXES.findIndex(([c]) => c === cat)).flatMap(([, p]) => p);
  const excl = earlier.map((p) => notLike(auditEvents.action, `${p}%`));
  if (!own.length) {
    // "Configurações e equipe" = tudo o que não caiu em nenhuma categoria.
    const all = ACTIVITY_CATEGORY_PREFIXES.flatMap(([, p]) => p);
    return and(...all.map((p) => notLike(auditEvents.action, `${p}%`)))!;
  }
  return and(or(...own.map((p) => like(auditEvents.action, `${p}%`)))!, ...excl)!;
}

/** Contato ligado ao evento (para mostrar o nome e abrir o painel do contato). */
const contactIdSql = sql<string | null>`case ${auditEvents.entityType}
  when 'contact' then ${auditEvents.entityId}
  when 'lead' then (select l.contact_id from leads l where l.id = ${auditEvents.entityId})
  when 'opportunity' then (select o.contact_id from opportunities o where o.id = ${auditEvents.entityId})
  when 'conversation' then (select cv.contact_id from conversations cv where cv.id = ${auditEvents.entityId})
  when 'appointment' then (select a.contact_id from appointments a where a.id = ${auditEvents.entityId})
  else null end`;

export async function listTeamActivity(ctx: Ctx, f: ActivityQuery) {
  assertCan(ctx, "team.manage", "Somente administradores veem o histórico da equipe.");
  const { start, end } = periodRange(f.periodo, ctx.org.timezone);
  const conds: SQL[] = [eq(auditEvents.orgId, ctx.orgId), isNotNull(auditEvents.actorId), gte(auditEvents.createdAt, start), lt(auditEvents.createdAt, end)];
  if (f.pessoa) conds.push(eq(auditEvents.actorId, f.pessoa));
  if (f.tipo) conds.push(categoryCondition(f.tipo));
  if (f.cursor) {
    const [at, id] = f.cursor.split("|");
    if (at && id && /^[0-9a-f-]{36}$/i.test(id)) {
      conds.push(sql`(${auditEvents.createdAt}, ${auditEvents.id}) < (${at}::timestamptz, ${id}::uuid)`);
    }
  }
  const rows = await db
    .select({
      id: auditEvents.id,
      action: auditEvents.action,
      entityType: auditEvents.entityType,
      entityId: auditEvents.entityId,
      data: auditEvents.data,
      createdAt: auditEvents.createdAt,
      cursorAt: sql<string>`to_char(${auditEvents.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      actorId: auditEvents.actorId,
      actorName: users.name,
      contactId: contactIdSql,
    })
    .from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(...conds))
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(PAGE + 1);

  const page = rows.slice(0, PAGE);
  const contactIds = [...new Set(page.map((r) => r.contactId).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (contactIds.length) {
    const found = await db.execute<{ id: string; name: string }>(
      sql`select id, name from contacts where org_id = ${ctx.orgId} and id in (${sql.join(contactIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
    );
    for (const c of Array.from(found)) names.set(c.id, c.name);
  }
  const last = page[page.length - 1];
  return {
    items: page.map(({ cursorAt: _c, contactId, ...r }) => ({
      ...r,
      contactId: contactId && names.has(contactId) ? contactId : null,
      contactName: contactId ? (names.get(contactId) ?? null) : null,
    })),
    nextCursor: rows.length > PAGE && last ? `${last.cursorAt}|${last.id}` : null,
  };
}

export const activitySummarySchema = z.object({ periodo: z.enum(PERIODS).default("7d") });

/** Uma linha por pessoa da equipe: último acesso, acessos e ações no período, sessões abertas. */
export async function teamActivitySummary(ctx: Ctx, f: z.infer<typeof activitySummarySchema>) {
  assertCan(ctx, "team.manage", "Somente administradores veem o histórico da equipe.");
  const { start, end } = periodRange(f.periodo, ctx.org.timezone);
  const now = new Date();
  const [members, counts, seen] = await Promise.all([
    db
      .select({ userId: users.id, name: users.name, email: users.email, role: memberships.role, status: memberships.status, lastLoginAt: users.lastLoginAt, avatarAt: userAvatars.updatedAt })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .leftJoin(userAvatars, eq(userAvatars.userId, users.id))
      .where(and(eq(memberships.orgId, ctx.orgId), sql`${memberships.status} <> 'pending'`))
      .orderBy(users.name),
    db
      .select({
        actorId: auditEvents.actorId,
        accesses: sql<number>`count(*) filter (where ${auditEvents.action} in ('auth.login', 'auth.session_resumed', 'auth.invite_accepted'))::int`,
        failed: sql<number>`count(*) filter (where ${auditEvents.action} = 'auth.login_failed')::int`,
        actions: sql<number>`count(*) filter (where ${auditEvents.action} not like 'auth.%')::int`,
        lastAction: sql<Date | null>`max(${auditEvents.createdAt}) filter (where ${auditEvents.action} not like 'auth.%')`,
      })
      .from(auditEvents)
      .where(and(eq(auditEvents.orgId, ctx.orgId), isNotNull(auditEvents.actorId), gte(auditEvents.createdAt, start), lt(auditEvents.createdAt, end)))
      .groupBy(auditEvents.actorId),
    db
      .select({
        userId: sessions.userId,
        lastSeenAt: max(sessions.lastSeenAt),
        openSessions: sql<number>`count(*) filter (where ${sessions.expiresAt} > ${now.toISOString()}::timestamptz)::int`,
      })
      .from(sessions)
      .where(eq(sessions.orgId, ctx.orgId))
      .groupBy(sessions.userId),
  ]);
  const byActor = new Map(counts.map((c) => [c.actorId, c]));
  const bySeen = new Map(seen.map((s) => [s.userId, s]));
  return members.map(({ avatarAt, ...m }) => {
    const c = byActor.get(m.userId);
    const s = bySeen.get(m.userId);
    const lastSeen = [s?.lastSeenAt, m.lastLoginAt].filter(Boolean).map((d) => new Date(d as Date).getTime());
    return {
      ...m,
      avatarUrl: avatarUrl(m.userId, avatarAt),
      lastSeenAt: lastSeen.length ? new Date(Math.max(...lastSeen)) : null,
      openSessions: s?.openSessions ?? 0,
      accesses: c?.accesses ?? 0,
      failedLogins: c?.failed ?? 0,
      actions: c?.actions ?? 0,
      lastActionAt: c?.lastAction ?? null,
    };
  });
}
