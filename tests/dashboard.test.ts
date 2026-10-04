import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { conversations, messages, stageHistory } from "@/server/db/schema";
import { setupOrg } from "./helpers";
import { createContact } from "@/server/services/contacts";
import { getBoard, moveEntry } from "@/server/services/board";
import { listStages } from "@/server/services/stages";
import { createAppointment, createOpportunity, decideOpportunity, updateAppointment } from "@/server/services/commercial";
import { getDashboard } from "@/server/services/dashboard";
import { periodRange } from "@/server/time";

describe("Dashboard calculado", () => {
  it("organização vazia mostra zero (nunca números fictícios)", async () => {
    const { ctx } = await setupOrg();
    const d = await getDashboard(ctx.admin, { period: "month" });
    expect(d.metrics).toEqual({ novosInteressados: 0, conversasAtivas: 0, reunioesAgendadas: 0, vendasFechadasCents: 0, vendasFechadasCount: 0 });
    expect(d.distribution.every((s) => s.n === 0)).toBe(true);
    expect(d.distribution).toHaveLength(6);
  });

  it("bate com registros de teste conhecidos", async () => {
    const { ctx, org, users } = await setupOrg();
    const stages = await listStages(ctx.admin, "relationship");
    const novo = stages.find((s) => s.key === "novo-interessado")!;
    const eng = stages[0];

    // 2 contatos entram em Novo interessado; um sai e volta (não conta duas vezes)
    const a = await createContact(ctx.seller, { name: "A", stageId: novo.id });
    await createContact(ctx.seller, { name: "B", stageId: novo.id });
    await createContact(ctx.seller2, { name: "C", stageId: eng.id });
    const cardA = (await getBoard(ctx.admin, {})).stages.flatMap((s) => s.cards).find((c) => c.contactId === a.id)!;
    await moveEntry(ctx.admin, cardA.entryId, { toStageId: eng.id, expectedVersion: cardA.version });
    await moveEntry(ctx.admin, cardA.entryId, { toStageId: novo.id, expectedVersion: cardA.version + 1 });

    // Contato cuja primeira entrada em Novo interessado foi antes do período não conta
    const old = await createContact(ctx.seller, { name: "Antigo", stageId: eng.id });
    const before = new Date(periodRange("month", "America/Bahia").start.getTime() - 86400000);
    await db.insert(stageHistory).values({ orgId: org.id, entityType: "relationship", entityId: old.id, contactId: old.id, toStageId: novo.id, toStageName: "Novo interessado", createdAt: before });
    await db.insert(stageHistory).values({ orgId: org.id, entityType: "relationship", entityId: old.id, contactId: old.id, toStageId: novo.id, toStageName: "Novo interessado" });

    // Conversa ativa: aberta com mensagem no período
    const [conv] = await db.insert(conversations).values({ orgId: org.id, contactId: a.id, channel: "instagram", ownerId: users.seller.id, lastMessageDirection: "in", lastMessageAt: new Date() }).returning();
    await db.insert(messages).values({ orgId: org.id, conversationId: conv.id, direction: "in", body: "Oi", status: "received" });

    // Reuniões: 1 válida, 1 cancelada
    const now = Date.now();
    await createAppointment(ctx.seller, { contactId: a.id, title: "Call", startsAt: new Date(now), endsAt: new Date(now + 3600000), timezone: "America/Bahia" });
    const canceled = await createAppointment(ctx.seller, { contactId: a.id, title: "Call 2", startsAt: new Date(now), endsAt: new Date(now + 3600000), timezone: "America/Bahia" });
    await updateAppointment(ctx.seller, canceled.id, { status: "canceled" });

    // Vendas: 1 ganha (R$ 40.000), 1 perdida, 1 aberta
    const o1 = await createOpportunity(ctx.admin, { contactId: a.id, title: "Mentoria", valueCents: 4_000_000, closerId: users.closer.id });
    const o2 = await createOpportunity(ctx.admin, { contactId: a.id, title: "Outra", valueCents: 999_00, closerId: users.closer.id });
    await createOpportunity(ctx.admin, { contactId: a.id, title: "Aberta", valueCents: 123_00 });
    await decideOpportunity(ctx.closer, o1.id, { status: "won" });
    await decideOpportunity(ctx.closer, o2.id, { status: "lost", lostReason: "Sem orçamento" });

    const d = await getDashboard(ctx.admin, { period: "month" });
    expect(d.metrics).toEqual({ novosInteressados: 2, conversasAtivas: 1, reunioesAgendadas: 1, vendasFechadasCents: 4_000_000, vendasFechadasCount: 1 });
    expect(d.distribution.find((s) => s.stageId === novo.id)!.n).toBe(2);
    expect(d.distribution.find((s) => s.stageId === eng.id)!.n).toBe(2);
    expect(d.awaiting).toHaveLength(1);

    // Escopo: seller 2 só vê o próprio contato
    const d2 = await getDashboard(ctx.seller2, { period: "month" });
    expect(d2.metrics.novosInteressados).toBe(0);
    expect(d2.distribution.reduce((acc, s) => acc + s.n, 0)).toBe(1);

    // Filtro por responsável
    const d3 = await getDashboard(ctx.admin, { period: "month", ownerId: users.seller.id });
    expect(d3.metrics.novosInteressados).toBe(2);

    // Reabrir venda recalcula as métricas
    await decideOpportunity(ctx.closer, o1.id, { status: "open" });
    expect((await getDashboard(ctx.admin, { period: "month" })).metrics.vendasFechadasCents).toBe(0);
  });

  it("perda exige motivo; seller não registra ganho", async () => {
    const { ctx, users } = await setupOrg();
    const c = await createContact(ctx.seller, { name: "A" });
    const o = await createOpportunity(ctx.seller, { contactId: c.id, title: "X", valueCents: 100, closerId: users.closer.id });
    await expect(decideOpportunity(ctx.seller, o.id, { status: "won" })).rejects.toMatchObject({ code: "forbidden" });
  });
});
