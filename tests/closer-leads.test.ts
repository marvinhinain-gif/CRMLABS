import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { leads } from "@/server/db/schema";
import { addLeadToBoard, forwardLeadToKanban, getLead, listLeads, scheduleLead, submitPublicForm, updateLead } from "@/server/services/leads";
import { createForm } from "@/server/services/integrations";
import { canReceive } from "@/server/realtime";
import { setupOrg } from "./helpers";

const base = { consent: true as const, startedAt: Date.now() - 10_000 };

describe("closer acompanha todos os leads", () => {
  it("vê a fila do SDR e os leads de cada SDR, mas só mexe nos que chegaram a ele", async () => {
    const { ctx, users: u } = await setupOrg();
    const form = await createForm(ctx.admin, { name: "Mentoria", headline: "Quero saber mais", questions: [] });
    await submitPublicForm(form.slug, { ...base, name: "Ana Souza", phone: "71999991111" }, "1.1.1.1");
    await submitPublicForm(form.slug, { ...base, name: "Bruno Costa", phone: "71988882222" }, "1.1.1.2");
    const [ana, bruno] = await db.select().from(leads).orderBy(leads.createdAt);

    // Bruno vai para o Kanban do SDR; Ana fica na fila sem responsável.
    await forwardLeadToKanban(ctx.seller, bruno.id, {});

    const all = await listLeads(ctx.closer, { status: "all", page: 1 });
    expect(all.rows.map((r) => r.name).sort()).toEqual(["Ana Souza", "Bruno Costa"]);
    expect((await listLeads(ctx.closer, { status: "open", page: 1 })).rows.map((r) => r.name)).toEqual(["Ana Souza"]);

    const detail = await getLead(ctx.closer, bruno.id);
    expect(detail.canEdit).toBe(false);
    expect(detail.board).toMatchObject({ inBoard: true, ownerId: u.seller.id });
    expect((await getLead(ctx.seller, bruno.id)).canEdit).toBe(true);

    // Só leitura: não muda status, score, Kanban nem marca reunião.
    await expect(updateLead(ctx.closer, ana.id, { status: "contacted" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(addLeadToBoard(ctx.closer, ana.id, {})).rejects.toMatchObject({ code: "forbidden" });
    const startsAt = new Date(Date.now() + 2 * 86400000);
    await expect(scheduleLead(ctx.closer, ana.id, { startsAt, endsAt: new Date(startsAt.getTime() + 3600_000) })).rejects.toMatchObject({ code: "forbidden" });

    // Quando o SDR marca a reunião com o closer, o lead chega a ele e ele pode mexer.
    await scheduleLead(ctx.seller, bruno.id, { startsAt, endsAt: new Date(startsAt.getTime() + 3600_000), ownerId: u.closer.id });
    expect((await getLead(ctx.closer, bruno.id)).canEdit).toBe(true);
    await expect(updateLead(ctx.closer, bruno.id, { scoreClass: "MENTORIA" })).resolves.toBeTruthy();

    // Tempo real: a lista do closer atualiza quando chega lead.
    expect(canReceive(ctx.closer, { orgId: ctx.closer.orgId, topic: "leads", entityId: ana.id, ownerIds: [] })).toBe(true);
  });
});
