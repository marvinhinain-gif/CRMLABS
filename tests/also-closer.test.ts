import { describe, expect, it } from "vitest";
import { setupOrg, ctxFor } from "./helpers";
import { createContact } from "@/server/services/contacts";
import { busyTimes } from "@/server/services/calendar";
import { createAppointment, forwardStatus, forwardToCloser, getCommercialBoard } from "@/server/services/commercial";
import { listMembers, updateMember } from "@/server/services/team";
import { buildMe } from "@/server/services/me";

describe("administrador que também é closer", () => {
  it("entra nas listas de closer, abre no próprio Kanban e recebe encaminhamentos", async () => {
    const { org, ctx, users: u } = await setupOrg();
    const maria = await createContact(ctx.seller, { name: "Maria Silva", phone: "+5571999990001" });

    // Antes: só a closer aparece para o social seller.
    expect((await forwardStatus(ctx.seller, maria.id)).closers.map((c) => c.name)).toEqual(["Carla"]);

    // Só o administrador marca; social seller e closer não podem ter a opção.
    await expect(updateMember(ctx.manager, u.admin.id, { alsoCloser: true })).rejects.toMatchObject({ code: "forbidden" });
    await expect(updateMember(ctx.admin, u.seller.id, { alsoCloser: true })).rejects.toMatchObject({ code: "invalid" });
    await updateMember(ctx.admin, u.admin.id, { alsoCloser: true });
    expect((await listMembers(ctx.admin)).find((m) => m.userId === u.admin.id)?.alsoCloser).toBe(true);

    const admin = await ctxFor(u.admin.id, org.id);
    expect(admin.alsoCloser).toBe(true);
    expect((await buildMe(admin)).user.alsoCloser).toBe(true);

    // Aparece em "Encaminhar para closer" e recebe o lead no próprio Kanban.
    expect((await forwardStatus(ctx.seller, maria.id)).closers.map((c) => c.name)).toEqual(["Admin", "Carla"]);
    const opp = await forwardToCloser(ctx.seller, maria.id, { closerId: u.admin.id });
    const board = await getCommercialBoard(admin, {});
    expect(board.ownerId).toBe(u.admin.id);
    expect(board.cards.map((c) => c.id)).toContain(opp.id);
    expect(board.people.find((p) => p.id === u.admin.id)?.isCloser).toBe(true);
    // Gestor sem a opção continua abrindo no Kanban do primeiro closer.
    expect((await getCommercialBoard(ctx.manager, {})).ownerId).toBe(u.admin.id);

    // Social seller pode agendar reunião com ele e ver os horários ocupados.
    const start = new Date(Date.now() + 86400_000);
    await createAppointment(ctx.seller, { contactId: maria.id, ownerId: u.admin.id, title: "Diagnóstico", startsAt: start, endsAt: new Date(start.getTime() + 3600_000), timezone: "America/Bahia" });
    await expect(busyTimes(ctx.seller, { ownerId: u.admin.id, date: start.toISOString().slice(0, 10) })).resolves.toBeTruthy();

    // Desmarcar tira das listas de closer.
    await updateMember(ctx.admin, u.admin.id, { alsoCloser: false });
    expect((await forwardStatus(ctx.seller, maria.id)).closers.map((c) => c.name)).toEqual(["Carla"]);
    await expect(busyTimes(ctx.seller, { ownerId: u.manager.id, date: start.toISOString().slice(0, 10) })).rejects.toMatchObject({ code: "forbidden" });
  });
});
