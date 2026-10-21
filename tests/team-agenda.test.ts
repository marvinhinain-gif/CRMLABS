import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";
import { busyTimes, icsFeed, myCalendar } from "@/server/services/calendar";
import { createAppointment } from "@/server/services/commercial";
import { createContact } from "@/server/services/contacts";
import { cancelTeamEvent, createTeamEvent, getTeamEvent, listTeamAgenda, teamEventReminders, updateTeamEvent } from "@/server/services/teamAgenda";
import { setupOrg } from "./helpers";

const tomorrowAt = (h: number, m = 0) => {
  const d = new Date(Date.now() + 86400000);
  return new Date(`${d.toISOString().slice(0, 10)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`);
};
const notesOf = (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId));
const day = (d: Date) => ({ from: new Date(d.getTime() - 12 * 3600_000), to: new Date(d.getTime() + 12 * 3600_000) });

describe("agenda da equipe", () => {
  it("marca um compromisso com a pessoa, notifica e aparece na agenda dela", async () => {
    const { ctx, users: u } = await setupOrg();
    const e = await createTeamEvent(ctx.manager, { title: "Alinhamento semanal", startsAt: tomorrowAt(10), endsAt: tomorrowAt(11), allDay: false, participantIds: [u.manager.id, u.seller.id] });
    const [n] = await notesOf(u.seller.id);
    expect(n).toMatchObject({ type: "agenda.invited", link: `/agenda?compromisso=${e.id}` });
    expect(n.title).toContain("Gestora marcou um compromisso com você");
    expect(n.body).toContain("Alinhamento semanal");
    // Quem marcou não é notificado.
    expect(await notesOf(u.manager.id)).toHaveLength(0);

    // Agenda da Mariana (vista por outra pessoa da equipe) traz o compromisso; a do Rafael, não.
    const mine = await listTeamAgenda(ctx.seller2, { ...day(tomorrowAt(10)), userId: u.seller.id });
    expect(mine.map((i) => i.id)).toEqual([e.id]);
    expect(mine[0].participantIds.sort()).toEqual([u.manager.id, u.seller.id].sort());
    expect(await listTeamAgenda(ctx.seller, { ...day(tomorrowAt(10)), userId: u.seller2.id })).toHaveLength(0);

    // Só quem marcou (ou gestor) altera.
    await expect(updateTeamEvent(ctx.seller, e.id, { title: "Outro" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createTeamEvent(ctx.seller, { title: "X", startsAt: tomorrowAt(11), endsAt: tomorrowAt(10), allDay: false, participantIds: [u.seller.id] })).rejects.toMatchObject({ code: "invalid" });
  });

  it("remarcar avisa quem continua, convida quem entrou e avisa quem saiu; cancelar avisa todos", async () => {
    const { ctx, users: u } = await setupOrg();
    const e = await createTeamEvent(ctx.seller, { title: "Revisar roteiro", startsAt: tomorrowAt(14), endsAt: tomorrowAt(15), allDay: false, participantIds: [u.seller.id, u.closer.id] });
    const detail = await updateTeamEvent(ctx.seller, e.id, { startsAt: tomorrowAt(16), endsAt: tomorrowAt(17), participantIds: [u.seller.id, u.seller2.id] });
    expect(detail.participants.map((p) => p.userId).sort()).toEqual([u.seller.id, u.seller2.id].sort());
    expect((await notesOf(u.closer.id)).map((n) => n.type).sort()).toEqual(["agenda.canceled", "agenda.invited"]);
    expect((await notesOf(u.seller2.id)).map((n) => n.type)).toEqual(["agenda.invited"]);

    await updateTeamEvent(ctx.seller, e.id, { startsAt: tomorrowAt(18), endsAt: tomorrowAt(19) });
    expect((await notesOf(u.seller2.id)).map((n) => n.type).sort()).toEqual(["agenda.invited", "agenda.updated"]);

    // Gestor pode cancelar compromisso de outra pessoa.
    const canceled = await cancelTeamEvent(ctx.manager, e.id);
    expect(canceled.canceledAt).not.toBeNull();
    expect((await notesOf(u.seller.id)).map((n) => n.type)).toContain("agenda.canceled");
    await expect(updateTeamEvent(ctx.seller, e.id, { title: "Y" })).rejects.toMatchObject({ code: "invalid" });
  });

  it("lembrete sai uma vez, na janela escolhida", async () => {
    const { ctx, users: u } = await setupOrg();
    const start = new Date(Date.now() + 20 * 60_000);
    const e = await createTeamEvent(ctx.admin, { title: "Treinamento", startsAt: start, endsAt: new Date(start.getTime() + 3600_000), allDay: false, participantIds: [u.admin.id, u.closer.id], reminderMinutes: 30 });
    await createTeamEvent(ctx.admin, { title: "Mais tarde", startsAt: new Date(Date.now() + 3 * 3600_000), endsAt: new Date(Date.now() + 4 * 3600_000), allDay: false, participantIds: [u.closer.id], reminderMinutes: 30 });
    await createTeamEvent(ctx.admin, { title: "Sem lembrete", startsAt: start, endsAt: new Date(start.getTime() + 3600_000), allDay: false, participantIds: [u.closer.id], reminderMinutes: null });
    expect(await teamEventReminders()).toBe(2);
    expect(await teamEventReminders()).toBe(0);
    const reminders = (await notesOf(u.closer.id)).filter((n) => n.type === "agenda.reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0].body).toMatch(/Treinamento começa em (19|20) minutos/);
    expect(reminders[0].link).toBe(`/agenda?compromisso=${e.id}`);
  });

  it("reunião com cliente ocupa a agenda, mas só mostra o cliente para quem pode vê-la", async () => {
    const { ctx, users: u } = await setupOrg();
    const c = await createContact(ctx.admin, { name: "Pedro Lima" });
    await createAppointment(ctx.admin, { contactId: c.id, ownerId: u.closer.id, title: "Diagnóstico", startsAt: tomorrowAt(9), endsAt: tomorrowAt(10), timezone: "America/Bahia" });
    const forSeller = await listTeamAgenda(ctx.seller, { ...day(tomorrowAt(9)), userId: u.closer.id });
    expect(forSeller).toHaveLength(1);
    expect(forSeller[0]).toMatchObject({ kind: "meeting", restricted: true, title: "Reunião com cliente", contactName: null });
    const forManager = await listTeamAgenda(ctx.manager, { ...day(tomorrowAt(9)), userId: u.closer.id });
    expect(forManager[0]).toMatchObject({ kind: "meeting", restricted: false, title: "Diagnóstico", contactName: "Pedro Lima" });
  });

  it("compromisso conta como ocupado e entra no link ICS da pessoa", async () => {
    const { ctx, users: u } = await setupOrg();
    const e = await createTeamEvent(ctx.admin, { title: "Reunião de time", startsAt: tomorrowAt(15), endsAt: tomorrowAt(15, 30), allDay: false, participantIds: [u.closer.id], location: "Sala 2" });
    const busy = await busyTimes(ctx.closer, { ownerId: u.closer.id, date: tomorrowAt(15).toISOString().slice(0, 10) });
    expect(busy.busy).toEqual([expect.objectContaining({ label: "Reunião de time", source: "crm" })]);
    const cal = await myCalendar(ctx.closer);
    const ics = (await icsFeed(cal.feedUrl.split("/").pop()!))!;
    expect(ics).toContain(`UID:${e.id}@crmlabs-agenda`);
    expect(ics).toContain("SUMMARY:Reunião de time");
    const detail = await getTeamEvent(ctx.closer, e.id);
    expect(detail).toMatchObject({ canEdit: false, location: "Sala 2", createdByName: "Admin" });
  });
});
