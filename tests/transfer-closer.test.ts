import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications, tasks } from "@/server/db/schema";
import { setupOrg, makeUser, ctxFor } from "./helpers";
import { createContact } from "@/server/services/contacts";
import { forwardToCloser, getCommercialBoard, getOpportunityDetail, updateOpportunity } from "@/server/services/commercial";
import { createTask } from "@/server/services/tasks";

describe("transferir lead para outro closer", () => {
  it("gestor transfere: mesma etapa no Kanban do novo closer, tarefas vão junto, histórico e aviso", async () => {
    const { org, ctx, users: u } = await setupOrg();
    const bruno = await makeUser(org.id, "closer", { name: "Bruno" });
    const brunoCtx = await ctxFor(bruno.id, org.id);
    const maria = await createContact(ctx.seller, { name: "Maria Silva", phone: "+5571999990000" });
    const opp = await forwardToCloser(ctx.seller, maria.id, { closerId: u.closer.id });

    // Carla avança para "Reunião agendada" e tem uma tarefa aberta do lead.
    let board = await getCommercialBoard(ctx.closer, {});
    const scheduled = board.stages.find((s) => s.stageType === "scheduled")!;
    await updateOpportunity(ctx.closer, opp.id, { stageId: scheduled.id });
    const task = await createTask(ctx.closer, { title: "Mandar proposta", contactId: maria.id, opportunityId: opp.id, ownerId: u.closer.id, dueAt: null });

    // Closer não transfere para outro closer; gestor sim.
    await expect(updateOpportunity(ctx.closer, opp.id, { closerId: bruno.id })).rejects.toMatchObject({ code: "forbidden" });
    const o = await updateOpportunity(ctx.admin, opp.id, { closerId: bruno.id });
    expect(o.closerId).toBe(bruno.id);

    // Sai do Kanban da Carla e entra no do Bruno, na etapa equivalente.
    board = await getCommercialBoard(ctx.closer, {});
    expect(board.cards.find((c) => c.id === opp.id)).toBeUndefined();
    const brunoBoard = await getCommercialBoard(brunoCtx, {});
    const card = brunoBoard.cards.find((c) => c.id === opp.id)!;
    expect(brunoBoard.stages.find((s) => s.id === card.stageId)?.stageType).toBe("scheduled");

    const [t] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(t.ownerId).toBe(bruno.id);

    const detail = await getOpportunityDetail(brunoCtx, opp.id);
    expect(detail.history[0].reason).toBe("Transferido de Carla para Bruno");
    const [n] = await db.select().from(notifications).where(and(eq(notifications.userId, bruno.id), eq(notifications.type, "opportunity.assigned")));
    expect(n).toMatchObject({ body: "Maria Silva agora está com você (transferido por Admin).", link: `/comercial?op=${opp.id}` });

    // Carla não vê mais a oportunidade.
    await expect(getOpportunityDetail(ctx.closer, opp.id)).rejects.toMatchObject({ code: "not_found" });
  });
});
