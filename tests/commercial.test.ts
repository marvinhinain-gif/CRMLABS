import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { notifications, salesEvents, stageHistory } from "@/server/db/schema";
import { setupOrg, makeUser, ctxFor } from "./helpers";
import { createContact } from "@/server/services/contacts";
import { createAppointment, decideOpportunity, forwardStatus, forwardToCloser, getCommercialBoard, getOpportunityDetail, updateAppointment, updateOpportunity } from "@/server/services/commercial";
import { archiveStage, createStage, listStages, updateStage } from "@/server/services/stages";
import { getCommercialDashboard, setGoal } from "@/server/services/metrics";
import { addChecklistItem, addTaskLink, createTask, getTask, listTasks, taskReminders, updateChecklistItem } from "@/server/services/tasks";
import { pickMessage, runDailyNudges, MORNING } from "@/server/services/nudges";
import { recordContactMade } from "@/server/services/salesEvents";

const month = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

describe("fluxo comercial: social seller → closer → venda → dashboard", () => {
  it("encaminha, entra no Kanban do closer, avança pelas etapas e o dashboard recalcula", async () => {
    const { ctx, users: u } = await setupOrg();
    const maria = await createContact(ctx.seller, { name: "Maria Silva", phone: "+5571999990000" });

    // Social seller fala com a Maria e marca a reunião com a closer.
    await recordContactMade(ctx.seller, maria.id);
    const st = await forwardStatus(ctx.seller, maria.id);
    expect(st.current).toBeNull();
    expect(st.closers.map((c) => c.name)).toEqual(["Carla"]);
    const opp = await forwardToCloser(ctx.seller, maria.id, { closerId: u.closer.id, note: "Fatura 40k/mês, quer escalar." });
    expect(opp.closerName).toBe("Carla");
    expect((await forwardStatus(ctx.seller, maria.id)).current).toMatchObject({ closerName: "Carla", stageName: "Novo Lead" });
    await expect(forwardToCloser(ctx.seller, maria.id, { closerId: u.closer.id })).rejects.toMatchObject({ code: "invalid" });

    // Closer foi avisado e o lead está na entrada do Kanban dele, com a observação do seller.
    const [n] = await db.select().from(notifications).where(and(eq(notifications.userId, u.closer.id), eq(notifications.type, "opportunity.forwarded")));
    expect(n).toMatchObject({ title: "🔥 Novo Lead recebido", body: "Maria Silva foi encaminhada para você por Mariana.", link: `/comercial?op=${opp.id}` });
    let board = await getCommercialBoard(ctx.closer, {});
    expect(board.canEdit).toBe(true);
    const entry = board.stages.find((s) => s.stageType === "entry")!;
    expect(board.cards.find((c) => c.id === opp.id)).toMatchObject({ stageId: entry.id, sellerName: "Mariana" });
    const detail = await getOpportunityDetail(ctx.closer, opp.id);
    expect(detail.notes[0].body).toContain("Fatura 40k/mês");
    expect(detail.history[0].reason).toBe("Lead qualificado por Social seller — Mariana · encaminhado para Closer — Carla");
    await expect(getCommercialBoard(ctx.seller, {})).rejects.toMatchObject({ code: "forbidden" });

    // Reunião marcada pela seller → card avança sozinho para "Reunião agendada".
    const start = new Date(Date.now() - 2 * 3600_000);
    const appt = await createAppointment(ctx.seller, { contactId: maria.id, ownerId: u.closer.id, title: "Diagnóstico", startsAt: start, endsAt: new Date(start.getTime() + 3600_000), timezone: "America/Bahia" });
    board = await getCommercialBoard(ctx.closer, {});
    const byType = (t: string) => board.stages.find((s) => s.stageType === t)!;
    expect(board.cards[0].stageId).toBe(byType("scheduled").id);

    // Closer arrasta para "Reunião realizada": a reunião pendente vira realizada.
    let o = await updateOpportunity(ctx.closer, opp.id, { stageId: byType("meeting_done").id });
    const [doneEv] = await db.select().from(salesEvents).where(and(eq(salesEvents.appointmentId, appt.id), eq(salesEvents.type, "meeting_done")));
    expect(doneEv).toBeTruthy();
    // Venda ganha exige valor; perdida exige motivo.
    await expect(updateOpportunity(ctx.closer, opp.id, { stageId: byType("won").id })).rejects.toMatchObject({ details: { need: "wonValueCents" } });
    o = await updateOpportunity(ctx.closer, opp.id, { stageId: byType("won").id, wonValueCents: 4_000_000 });
    expect(o).toMatchObject({ status: "won", stageId: byType("won").id, valueCents: 4_000_000 });

    const hist = await db.select().from(stageHistory).where(eq(stageHistory.entityId, opp.id));
    expect(hist.map((h) => h.toStageName)).toEqual(expect.arrayContaining(["Novo Lead", "Reunião agendada", "Reunião realizada", "Fechado"]));

    await setGoal(ctx.admin, { month: month(), targetCents: 10_000_000 });
    await expect(setGoal(ctx.manager, { month: month(), targetCents: 1 })).rejects.toMatchObject({ code: "forbidden" });
    let d = await getCommercialDashboard(ctx.admin, { period: "month" });
    expect(d.kpis).toMatchObject({ contacts: 1, scheduled: 1, done: 1, sales: 1, revenueCents: 4_000_000 });
    expect(d.conversions).toEqual({ contactToMeeting: 100, meetingToShow: 100, meetingToSale: 100, contactToSale: 100 });
    expect(d.meta).toMatchObject({ targetCents: 10_000_000, realizedCents: 4_000_000, remainingCents: 6_000_000, progress: 40 });
    expect(d.closerRanking).toEqual([{ userId: u.closer.id, name: "Carla", sales: 1, revenueCents: 4_000_000, avgTicketCents: 4_000_000 }]);
    expect(d.schedulerRanking).toEqual([{ userId: u.seller.id, name: "Mariana", role: "seller", scheduled: 1, done: 1, sold: 1 }]);

    // Social seller vê os próprios números; outro seller não vê nada.
    expect((await getCommercialDashboard(ctx.seller, { period: "month" })).kpis.sales).toBe(1);
    expect((await getCommercialDashboard(ctx.seller2, { period: "month" })).kpis).toMatchObject({ sales: 0, contacts: 0 });
    expect((await getCommercialDashboard(ctx.seller, { period: "month" })).closerRanking).toEqual([]);

    // Reabrir anula a venda (evento preservado, mas fora das métricas).
    await decideOpportunity(ctx.closer, opp.id, { status: "open" });
    d = await getCommercialDashboard(ctx.admin, { period: "month" });
    expect(d.kpis.sales).toBe(0);
    expect(d.meta.realizedCents).toBe(0);
    const evs = await db.select().from(salesEvents).where(and(eq(salesEvents.opportunityId, opp.id), eq(salesEvents.type, "sale_won")));
    expect(evs).toHaveLength(1);
    expect(evs[0].voidedAt).toBeInstanceOf(Date);
    // Reunião que deixa de ser "realizada" também sai da conta.
    await updateAppointment(ctx.closer, appt.id, { status: "no_show" });
    d = await getCommercialDashboard(ctx.admin, { period: "month" });
    expect(d.kpis).toMatchObject({ done: 0, noShow: 1 });
  });

  it("closer personaliza o próprio Kanban sem perder as etapas que alimentam as métricas", async () => {
    const { ctx, users: u } = await setupOrg();
    const stages = await listStages(ctx.closer, "sales");
    expect(stages.map((s) => s.name)).toEqual(["Novo Lead", "Contato realizado", "Reunião agendada", "Reunião realizada", "Follow-up", "Negociação", "Fechado", "Perdido"]);
    const call = await createStage(ctx.closer, { kind: "sales", name: "Call marcada", color: "yellow", stageType: "scheduled" });
    expect(call.stageType).toBe("scheduled");
    await updateStage(ctx.closer, stages[0].id, { name: "Entrada" });
    // Não pode ficar sem etapa de entrada/ganha/perdida.
    await expect(updateStage(ctx.closer, stages[0].id, { stageType: "custom" })).rejects.toMatchObject({ code: "invalid" });
    await expect(archiveStage(ctx.closer, stages[6].id)).rejects.toMatchObject({ code: "invalid" });
    await archiveStage(ctx.closer, stages[4].id);
    // Funil de outro closer não é afetado e não pode ser editado por ele.
    const other = await makeUser(ctx.closer.orgId, "closer", { name: "Lucas" });
    const otherCtx = await ctxFor(other.id, ctx.closer.orgId);
    expect((await listStages(otherCtx, "sales")).map((s) => s.name)[0]).toBe("Novo Lead");
    await expect(updateStage(otherCtx, stages[1].id, { name: "X" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(listStages(ctx.closer, "sales", { ownerId: other.id })).rejects.toMatchObject({ code: "forbidden" });
    // Gestor vê o Kanban de cada closer.
    const b = await getCommercialBoard(ctx.admin, { ownerId: u.closer.id });
    expect(b.stages.map((s) => s.name)).toContain("Call marcada");
    expect(b.people.map((p) => p.name)).toEqual(expect.arrayContaining(["Carla", "Lucas"]));
  });
});

describe("tarefas completas", () => {
  it("checklist, materiais, tarefa no lead, aviso de atribuição e lembretes sem duplicar", async () => {
    const { ctx, users: u } = await setupOrg();
    const maria = await createContact(ctx.seller, { name: "Maria Silva" });
    const due = new Date(Date.now() + 20 * 60_000);
    const t = await createTask(ctx.seller, {
      title: "Fazer follow-up",
      notes: "Ligar após o almoço",
      ownerId: u.closer.id,
      contactId: maria.id,
      priority: "high",
      dueAt: due,
      checklist: ["Revisar diagnóstico", "Analisar faturamento", "Preparar proposta"],
      links: [{ title: "Proposta Comercial", url: "docs.google.com/document/d/abc" }],
    });
    const [assigned] = await db.select().from(notifications).where(and(eq(notifications.userId, u.closer.id), eq(notifications.type, "task.assigned")));
    expect(assigned.body).toBe("Mariana atribuiu uma nova tarefa para você.");
    let full = await getTask(ctx.closer, t.id);
    expect(full.checklist.map((i) => i.text)).toEqual(["Revisar diagnóstico", "Analisar faturamento", "Preparar proposta"]);
    expect(full.links[0]).toMatchObject({ title: "Proposta Comercial", url: "https://docs.google.com/document/d/abc" });
    await updateChecklistItem(ctx.closer, t.id, full.checklist[0].id, { done: true });
    await addChecklistItem(ctx.closer, t.id, { text: "Enviar proposta" });
    await addTaskLink(ctx.closer, t.id, { title: "Gravação da reunião", url: "https://drive.google.com/x" });
    await expect(addTaskLink(ctx.closer, t.id, { title: "Ruim", url: "javascript:alert(1)" })).rejects.toBeTruthy();
    full = await getTask(ctx.closer, t.id);
    expect(full.checklist.filter((i) => i.done)).toHaveLength(1);
    expect(full.links).toHaveLength(2);
    // Aparece na página do lead para quem vê o lead.
    expect((await listTasks(ctx.seller, { view: "all", contactId: maria.id })).map((x) => x.title)).toEqual(["Fazer follow-up"]);
    const [row] = await listTasks(ctx.closer, { view: "today" });
    expect(row).toMatchObject({ priority: "high", checklistTotal: 4, checklistDone: 1, linkCount: 2 });
    // Lembrete 30 min antes: uma vez só.
    expect(await taskReminders()).toBe(1);
    expect(await taskReminders()).toBe(0);
    const [soon] = await db.select().from(notifications).where(and(eq(notifications.userId, u.closer.id), eq(notifications.type, "task.due_soon")));
    expect(soon.body).toMatch(/^Faltam \d+ minutos para Fazer follow-up com Maria\.$/);
  });
});

describe("mensagens diárias", () => {
  it("bom dia às 9h só para sellers e closers, uma vez por dia, e mensagens variam", async () => {
    const { ctx, users: u } = await setupOrg();
    // 09:05 em Salvador = 12:05 UTC
    const at9 = new Date("2026-10-06T12:05:00Z");
    const sent = await runDailyNudges(at9);
    expect(sent).toBeGreaterThanOrEqual(3);
    expect(await runDailyNudges(new Date("2026-10-06T13:30:00Z"))).toBe(0);
    const mine = await db.select().from(notifications).where(and(eq(notifications.userId, u.seller.id), eq(notifications.type, "daily.morning")));
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe("Bom dia, Mariana! 👋");
    const adminGot = await db.select().from(notifications).where(and(eq(notifications.userId, u.admin.id), eq(notifications.type, "daily.morning")));
    expect(adminGot).toHaveLength(0);
    expect(await runDailyNudges(new Date("2026-10-06T18:00:00Z"))).toBe(0); // 15h: nada
    const night = await runDailyNudges(new Date("2026-10-07T00:10:00Z")); // 21h10
    expect(night).toBeGreaterThanOrEqual(3);
    const days = new Set(Array.from({ length: MORNING.length }, (_, i) => pickMessage("morning", u.seller.id, 20000 + i).text));
    expect(days.size).toBe(MORNING.length);
    expect(pickMessage("morning", u.seller.id, 1)).not.toEqual(pickMessage("morning", u.seller.id, 2));
    void ctx;
  });
});
