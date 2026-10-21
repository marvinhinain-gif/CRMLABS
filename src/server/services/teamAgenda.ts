import { and, asc, eq, gt, inArray, isNull, isNotNull, lt, ne, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { appointments, contacts, memberships, teamEventParticipants, teamEvents, users } from "../db/schema";
import type { Ctx } from "../context";
import { appointmentScope, can, contactScope } from "../permissions";
import { forbidden, invalid, notFound } from "../errors";
import { audit, cleanText, notifyUser } from "./common";
import { formatDate, formatDateTime, formatTime } from "@/lib/format";
import { logger } from "../logger";

/**
 * Agenda da equipe: compromissos internos marcados com uma ou mais pessoas.
 * A equipe inteira vê a agenda de todos (para marcar sem conflito); reuniões com clientes entram
 * como "ocupado" e só mostram o cliente para quem já pode ver aquela reunião.
 */

export const REMINDER_OPTIONS = [0, 10, 30, 60, 120, 1440] as const;

const baseInput = {
  title: z.string().trim().min(1, "Dê um nome ao compromisso.").max(160),
  description: z.string().trim().max(2000).nullish(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  allDay: z.boolean().default(false),
  location: z.string().trim().max(300).nullish(),
  contactId: z.string().uuid().nullish(),
  participantIds: z.array(z.string().uuid()).min(1, "Escolha ao menos uma pessoa.").max(50),
  reminderMinutes: z.number().int().min(0).max(10080).nullish(),
};

export const teamEventInputSchema = z.object(baseInput);
export const updateTeamEventSchema = z.object(baseInput).partial();

export const teamAgendaSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  /** Agenda de uma pessoa; vazio = equipe toda. */
  userId: z.string().uuid().optional(),
});

export type TeamAgendaItem = {
  kind: "event" | "meeting";
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
  participantIds: string[];
  contactId: string | null;
  contactName: string | null;
  canceled: boolean;
  /** Reunião com cliente que a pessoa não pode abrir: aparece só como "ocupado". */
  restricted: boolean;
  createdBy: string | null;
};

const participantsSql = sql<string[]>`(select coalesce(json_agg(p.user_id order by p.user_id), '[]'::json) from ${teamEventParticipants} p where p.event_id = ${sql.raw('"team_events"."id"')})`;

function checkRange(startsAt: Date, endsAt: Date) {
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw invalid("Data inválida.");
  if (endsAt.getTime() <= startsAt.getTime()) throw invalid("O fim precisa ser depois do início.");
  if (endsAt.getTime() - startsAt.getTime() > 31 * 86400000) throw invalid("Um compromisso pode durar no máximo 31 dias.");
}

/** Pessoas ativas da organização entre as escolhidas (as demais são recusadas). */
async function assertParticipants(ctx: Ctx, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.status, "active"), inArray(memberships.userId, unique)));
  if (rows.length !== unique.length) throw invalid("Escolha pessoas ativas da equipe.");
  return unique;
}

async function assertContact(ctx: Ctx, contactId: string | null | undefined) {
  if (!contactId) return null;
  const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), contactScope(ctx)));
  if (!c) throw invalid("Contato não encontrado.");
  return c.id;
}

function when(e: { startsAt: Date; endsAt: Date; allDay: boolean }) {
  if (e.allDay) {
    const last = new Date(e.endsAt.getTime() - 1);
    const a = formatDate(e.startsAt);
    const b = formatDate(last);
    return a === b ? `${a} · dia inteiro` : `${a} a ${b}`;
  }
  return `${formatDateTime(e.startsAt)}–${formatTime(e.endsAt)}`;
}

const eventLink = (id: string) => `/agenda?compromisso=${id}`;

/** Avisa cada pessoa (menos quem fez a ação). Falhas nunca desfazem a operação principal. */
async function notifyPeople(ctx: Ctx, userIds: string[], alert: { type: string; title: string; body?: string; link?: string }) {
  for (const userId of new Set(userIds)) {
    if (userId === ctx.userId) continue;
    try {
      await notifyUser({ orgId: ctx.orgId, userId, ...alert });
    } catch (e) {
      logger.warn("Falha ao criar notificação da agenda", e);
    }
  }
}

const first = (name: string) => name.split(" ")[0];

export async function listTeamAgenda(ctx: Ctx, f: z.infer<typeof teamAgendaSchema>): Promise<TeamAgendaItem[]> {
  if (f.to.getTime() - f.from.getTime() > 62 * 86400000) throw invalid("Período longo demais.");
  const eventConds: SQL[] = [eq(teamEvents.orgId, ctx.orgId), lt(teamEvents.startsAt, f.to), gt(teamEvents.endsAt, f.from)];
  if (f.userId) eventConds.push(sql`exists (select 1 from ${teamEventParticipants} p where p.event_id = ${teamEvents.id} and p.user_id = ${f.userId})`);
  const events = await db
    .select({
      id: teamEvents.id,
      title: teamEvents.title,
      startsAt: teamEvents.startsAt,
      endsAt: teamEvents.endsAt,
      allDay: teamEvents.allDay,
      location: teamEvents.location,
      canceledAt: teamEvents.canceledAt,
      createdBy: teamEvents.createdBy,
      participantIds: participantsSql,
      contactId: sql<string | null>`case when ${contactScope(ctx)} then ${contacts.id} end`,
      contactName: sql<string | null>`case when ${contactScope(ctx)} then ${contacts.name} end`,
    })
    .from(teamEvents)
    .leftJoin(contacts, eq(contacts.id, teamEvents.contactId))
    .where(and(...eventConds))
    .orderBy(asc(teamEvents.startsAt))
    .limit(1000);

  const meetingConds: SQL[] = [eq(appointments.orgId, ctx.orgId), ne(appointments.status, "canceled"), isNotNull(appointments.ownerId), lt(appointments.startsAt, f.to), gt(appointments.endsAt, f.from)];
  if (f.userId) meetingConds.push(eq(appointments.ownerId, f.userId));
  const meetings = await db
    .select({
      id: appointments.id,
      title: appointments.title,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      location: appointments.location,
      ownerId: appointments.ownerId,
      contactId: appointments.contactId,
      contactName: contacts.name,
      visible: sql<boolean>`coalesce((${appointmentScope(ctx)}), false)`,
    })
    .from(appointments)
    .innerJoin(contacts, eq(contacts.id, appointments.contactId))
    .where(and(...meetingConds))
    .orderBy(asc(appointments.startsAt))
    .limit(1000);

  const items: TeamAgendaItem[] = [
    ...events.map((e) => ({
      kind: "event" as const,
      id: e.id,
      title: e.title,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      allDay: e.allDay,
      location: e.location,
      participantIds: e.participantIds ?? [],
      contactId: e.contactId,
      contactName: e.contactName,
      canceled: !!e.canceledAt,
      restricted: false,
      createdBy: e.createdBy,
    })),
    ...meetings.map((m) => ({
      kind: "meeting" as const,
      id: m.id,
      title: m.visible ? m.title : "Reunião com cliente",
      startsAt: m.startsAt,
      endsAt: m.endsAt,
      allDay: false,
      location: m.visible ? m.location : null,
      participantIds: [m.ownerId!],
      contactId: m.visible ? m.contactId : null,
      contactName: m.visible ? m.contactName : null,
      canceled: false,
      restricted: !m.visible,
      createdBy: null,
    })),
  ];
  return items.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.getTime() - b.startsAt.getTime());
}

const canEdit = (ctx: Ctx, e: { createdBy: string | null }) => e.createdBy === ctx.userId || can(ctx, "data.all");

async function loadEvent(ctx: Ctx, id: string) {
  const [e] = await db
    .select()
    .from(teamEvents)
    .where(and(eq(teamEvents.id, id), eq(teamEvents.orgId, ctx.orgId)));
  if (!e) throw notFound("Compromisso não encontrado.");
  const parts = await db.select({ userId: teamEventParticipants.userId }).from(teamEventParticipants).where(eq(teamEventParticipants.eventId, id));
  return { ...e, participantIds: parts.map((p) => p.userId) };
}

export async function getTeamEvent(ctx: Ctx, id: string) {
  const e = await loadEvent(ctx, id);
  const people = e.participantIds.length
    ? await db.select({ userId: users.id, name: users.name }).from(users).where(inArray(users.id, e.participantIds)).orderBy(asc(users.name))
    : [];
  const [author] = e.createdBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, e.createdBy)) : [];
  const [contact] = e.contactId
    ? await db.select({ id: contacts.id, name: contacts.name, phone: contacts.phone, username: contacts.username }).from(contacts).where(and(eq(contacts.id, e.contactId), contactScope(ctx)))
    : [];
  return {
    id: e.id,
    title: e.title,
    description: e.description,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    allDay: e.allDay,
    location: e.location,
    reminderMinutes: e.reminderMinutes,
    canceledAt: e.canceledAt,
    createdAt: e.createdAt,
    createdBy: e.createdBy,
    createdByName: author?.name ?? null,
    participants: people,
    contact: contact ?? null,
    canEdit: canEdit(ctx, e),
  };
}

export async function createTeamEvent(ctx: Ctx, input: z.infer<typeof teamEventInputSchema>) {
  checkRange(input.startsAt, input.endsAt);
  const participantIds = await assertParticipants(ctx, input.participantIds);
  const contactId = await assertContact(ctx, input.contactId);
  const e = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(teamEvents)
      .values({
        orgId: ctx.orgId,
        title: input.title.trim(),
        description: cleanText(input.description),
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        allDay: input.allDay ?? false,
        location: cleanText(input.location, 300),
        contactId,
        reminderMinutes: input.reminderMinutes === undefined ? 30 : input.reminderMinutes,
        createdBy: ctx.userId,
      })
      .returning();
    await tx.insert(teamEventParticipants).values(participantIds.map((userId) => ({ eventId: row.id, userId })));
    await audit(tx, ctx, "team_event.created", "team_event", row.id, { participants: participantIds });
    return row;
  });
  await notifyPeople(ctx, participantIds, {
    type: "agenda.invited",
    title: `📅 ${first(ctx.userName)} marcou um compromisso com você`,
    body: `${e.title} · ${when(e)}`,
    link: eventLink(e.id),
  });
  return { ...e, participantIds };
}

export async function updateTeamEvent(ctx: Ctx, id: string, input: z.infer<typeof updateTeamEventSchema>) {
  const e = await loadEvent(ctx, id);
  if (!canEdit(ctx, e)) throw forbidden("Só quem marcou o compromisso (ou um gestor) pode alterá-lo.");
  if (e.canceledAt) throw invalid("Este compromisso foi cancelado.");
  const startsAt = input.startsAt ?? e.startsAt;
  const endsAt = input.endsAt ?? e.endsAt;
  checkRange(startsAt, endsAt);
  const participantIds = input.participantIds ? await assertParticipants(ctx, input.participantIds) : e.participantIds;
  const contactId = input.contactId === undefined ? e.contactId : input.contactId === e.contactId ? e.contactId : await assertContact(ctx, input.contactId);
  const next = {
    title: input.title?.trim() ?? e.title,
    description: input.description === undefined ? e.description : cleanText(input.description),
    startsAt,
    endsAt,
    allDay: input.allDay ?? e.allDay,
    location: input.location === undefined ? e.location : cleanText(input.location, 300),
    contactId,
    reminderMinutes: input.reminderMinutes === undefined ? e.reminderMinutes : input.reminderMinutes,
  };
  const added = participantIds.filter((u) => !e.participantIds.includes(u));
  const removed = e.participantIds.filter((u) => !participantIds.includes(u));
  const kept = participantIds.filter((u) => e.participantIds.includes(u));
  await db.transaction(async (tx) => {
    await tx.update(teamEvents).set({ ...next, updatedAt: new Date() }).where(eq(teamEvents.id, id));
    if (removed.length) await tx.delete(teamEventParticipants).where(and(eq(teamEventParticipants.eventId, id), inArray(teamEventParticipants.userId, removed)));
    if (added.length) await tx.insert(teamEventParticipants).values(added.map((userId) => ({ eventId: id, userId })));
    await audit(tx, ctx, "team_event.updated", "team_event", id, { added, removed });
  });
  // Mudou o que importa para quem já estava: horário, local ou nome.
  const timeChanged = next.startsAt.getTime() !== e.startsAt.getTime() || next.endsAt.getTime() !== e.endsAt.getTime() || next.allDay !== e.allDay;
  const relevant = timeChanged || next.location !== e.location || next.title !== e.title;
  if (relevant)
    await notifyPeople(ctx, kept, {
      type: "agenda.updated",
      title: timeChanged ? `🔁 Compromisso remarcado: ${next.title}` : `✏️ Compromisso alterado: ${next.title}`,
      body: `${when(next)} · por ${ctx.userName}`,
      link: eventLink(id),
    });
  await notifyPeople(ctx, added, { type: "agenda.invited", title: `📅 ${first(ctx.userName)} marcou um compromisso com você`, body: `${next.title} · ${when(next)}`, link: eventLink(id) });
  await notifyPeople(ctx, removed, { type: "agenda.canceled", title: `Você não está mais em “${next.title}”`, body: `${when(e)} · alterado por ${ctx.userName}`, link: "/agenda" });
  return getTeamEvent(ctx, id);
}

export async function cancelTeamEvent(ctx: Ctx, id: string) {
  const e = await loadEvent(ctx, id);
  if (!canEdit(ctx, e)) throw forbidden("Só quem marcou o compromisso (ou um gestor) pode cancelá-lo.");
  if (e.canceledAt) return getTeamEvent(ctx, id);
  await db.update(teamEvents).set({ canceledAt: new Date(), updatedAt: new Date() }).where(eq(teamEvents.id, id));
  await audit(db, ctx, "team_event.canceled", "team_event", id);
  await notifyPeople(ctx, e.participantIds, { type: "agenda.canceled", title: `❌ Compromisso cancelado: ${e.title}`, body: `${when(e)} · por ${ctx.userName}`, link: eventLink(id) });
  return getTeamEvent(ctx, id);
}

/** Compromissos ativos da pessoa no período (para conflitos de horário e o link ICS). */
export async function eventsOf(orgId: string, userId: string, from: Date, to: Date | null, opts: { includeCanceled?: boolean; includeAllDay?: boolean } = {}) {
  const conds: SQL[] = [eq(teamEvents.orgId, orgId), gt(teamEvents.endsAt, from), eq(teamEventParticipants.userId, userId)];
  if (to) conds.push(lt(teamEvents.startsAt, to));
  if (!opts.includeCanceled) conds.push(isNull(teamEvents.canceledAt));
  if (!opts.includeAllDay) conds.push(eq(teamEvents.allDay, false));
  return db
    .select({
      id: teamEvents.id,
      title: teamEvents.title,
      description: teamEvents.description,
      startsAt: teamEvents.startsAt,
      endsAt: teamEvents.endsAt,
      allDay: teamEvents.allDay,
      location: teamEvents.location,
      canceledAt: teamEvents.canceledAt,
      updatedAt: teamEvents.updatedAt,
    })
    .from(teamEvents)
    .innerJoin(teamEventParticipants, eq(teamEventParticipants.eventId, teamEvents.id))
    .where(and(...conds))
    .orderBy(asc(teamEvents.startsAt))
    .limit(1000);
}

// ---------- Lembretes ----------
/**
 * Lembra cada participante X minutos antes do início (o que a pessoa escolheu ao marcar), uma única vez:
 * a chave inclui o horário, então remarcar gera um lembrete novo.
 */
export async function teamEventReminders(now = new Date()) {
  const rows = await db
    .select({
      id: teamEvents.id,
      orgId: teamEvents.orgId,
      title: teamEvents.title,
      startsAt: teamEvents.startsAt,
      endsAt: teamEvents.endsAt,
      allDay: teamEvents.allDay,
      location: teamEvents.location,
      reminderMinutes: teamEvents.reminderMinutes,
      userId: teamEventParticipants.userId,
    })
    .from(teamEvents)
    .innerJoin(teamEventParticipants, eq(teamEventParticipants.eventId, teamEvents.id))
    .innerJoin(memberships, and(eq(memberships.orgId, teamEvents.orgId), eq(memberships.userId, teamEventParticipants.userId), eq(memberships.status, "active")))
    .where(
      and(
        isNull(teamEvents.canceledAt),
        isNotNull(teamEvents.reminderMinutes),
        // Ainda não começou (ou começou há menos de 5 min, para o lembrete "na hora") e já entrou na janela do lembrete.
        gt(teamEvents.startsAt, new Date(now.getTime() - 5 * 60_000)),
        lt(teamEvents.startsAt, new Date(now.getTime() + 7 * 86400000 + 60_000)),
        sql`${teamEvents.startsAt} - make_interval(mins => ${teamEvents.reminderMinutes}) <= ${now.toISOString()}::timestamptz`,
      ),
    )
    .limit(500);
  let sent = 0;
  for (const r of rows) {
    const min = Math.round((r.startsAt.getTime() - now.getTime()) / 60_000);
    const body = r.allDay
      ? `${r.title} · ${when(r)}`
      : min <= 1
        ? `${r.title} começa agora${r.location ? ` · ${r.location}` : ""}.`
        : min < 120
          ? `${r.title} começa em ${min} minutos (${formatTime(r.startsAt)})${r.location ? ` · ${r.location}` : ""}.`
          : `${r.title} · ${when(r)}`;
    try {
      const created = await notifyUser({
        orgId: r.orgId,
        userId: r.userId,
        type: "agenda.reminder",
        title: "⏰ Lembrete de compromisso",
        body,
        link: eventLink(r.id),
        dedupeKey: `agenda:${r.id}:remind:${r.startsAt.getTime()}`,
      });
      if (created) sent++;
    } catch (e) {
      logger.warn("Falha no lembrete da agenda", e);
    }
  }
  return sent;
}
