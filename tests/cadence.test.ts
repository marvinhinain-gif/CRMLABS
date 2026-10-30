import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { cadenceSteps, contacts, relationshipEntries, salesEvents } from "@/server/db/schema";
import { setupOrg } from "./helpers";
import { createContact } from "@/server/services/contacts";
import { listStages } from "@/server/services/stages";
import { getBoard } from "@/server/services/board";
import { applyCadenceAction, getContactCadence, getQueue, listActiveSteps, saveSteps, saveStepsSchema } from "@/server/services/cadence";
import { DEFAULT_CADENCE_STEPS, fillScript } from "@/lib/cadence";

async function leadFor(owner: Awaited<ReturnType<typeof setupOrg>>["ctx"]["seller"], name = "Ana Souza") {
  const [s1] = await listStages(owner, "relationship");
  return createContact(owner, { name, stageId: s1.id });
}

const near = (d: Date | null, ms: number, tol = 5000) => expect(Math.abs(d!.getTime() - ms)).toBeLessThan(tol);

describe("Cadência do Social Seller", () => {
  it("organização nova já tem os passos padrão", async () => {
    const { ctx } = await setupOrg();
    const steps = await listActiveSteps(ctx.seller.orgId);
    expect(steps.map((s) => s.key)).toEqual(DEFAULT_CADENCE_STEPS.map((s) => s.key));
    expect(steps.map((s) => s.waitDays)).toEqual([0, 0, 1, 1, 2, 3]);
    expect(fillScript("Oi {nome}, aqui é {responsavel}", { nome: "Ana Souza", responsavel: "Mariana" })).toBe("Oi Ana, aqui é Mariana");
  });

  it("iniciar, não atendeu avança com o prazo certo e sincroniza a próxima ação", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    const started = await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    expect(started.entry).toMatchObject({ status: "active" });
    expect(started.currentStep?.key).toBe("ligacao-1");
    expect(started.activities[0].outcome).toBe("started");
    let [row] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(row.nextAction).toBe("Cadência: Ligação 1");

    const r1 = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "call_no_answer" });
    expect(r1.currentStep?.key).toBe("mensagem-1");
    near(r1.entry!.dueAt, Date.now()); // espera 0 dia
    const r2 = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "message_sent" });
    expect(r2.currentStep?.key).toBe("mensagem-2");
    near(r2.entry!.dueAt, Date.now() + 86_400_000); // espera 1 dia
    [row] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(row.nextAction).toBe("Cadência: Mensagem 2");
    near(row.nextActionAt, Date.now() + 86_400_000);
    expect(r2.activities.map((a) => a.outcome)).toEqual(["message_sent", "call_no_answer", "started"]);
    expect(r2.activities[0].stepName).toBe("Mensagem 1");
    const ev = await db.select().from(salesEvents).where(eq(salesEvents.contactId, c.id));
    expect(ev.some((e) => e.type === "contact_made")).toBe(true);
  });

  it("clique duplo: com expectedStepId o segundo registro não avança de novo", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    const started = await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    const stepId = started.currentStep!.id;
    const r1 = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "call_no_answer", expectedStepId: stepId });
    expect(r1.currentStep?.key).toBe("mensagem-1");
    await expect(applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "call_no_answer", expectedStepId: stepId })).rejects.toMatchObject({ code: "conflict" });
    const after = await getContactCadence(ctx.seller, c.id);
    expect(after.currentStep?.key).toBe("mensagem-1");
  });

  it("atendeu coloca em conversa e limpa o prazo; recomeçar volta ao início", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    const r = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "call_answered" });
    expect(r.entry).toMatchObject({ status: "responded", dueAt: null });
    const [row] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(row.nextAction).toBeNull();
    expect(row.nextActionAt).toBeNull();
    const again = await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    expect(again.entry!.status).toBe("active");
    expect(again.currentStep?.key).toBe("ligacao-1");
  });

  it("agendou e sem interesse mudam a situação", async () => {
    const { ctx } = await setupOrg();
    const a = await leadFor(ctx.seller, "A");
    const b = await leadFor(ctx.seller, "B");
    await applyCadenceAction(ctx.seller, a.id, { action: "start" });
    await applyCadenceAction(ctx.seller, b.id, { action: "start" });
    expect((await applyCadenceAction(ctx.seller, a.id, { action: "log", outcome: "scheduled" })).entry!.status).toBe("scheduled");
    expect((await applyCadenceAction(ctx.seller, b.id, { action: "log", outcome: "not_interested" })).entry!.status).toBe("lost");
  });

  it("no último passo, sem resposta encerra e mantém o passo", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    let r = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "call_no_answer" });
    for (let i = 0; i < 4; i++) r = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "message_sent" });
    expect(r.currentStep?.key).toBe("follow-up-final");
    expect(r.entry!.status).toBe("active");
    r = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "message_sent" });
    expect(r.entry).toMatchObject({ status: "finished", dueAt: null });
    expect(r.currentStep?.key).toBe("follow-up-final");
    const [row] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(row.nextAction).toBeNull();
  });

  it("anotação não avança, exige texto e vale mesmo sem cadência iniciada; outros resultados exigem cadência", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    await expect(applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "call_no_answer" })).rejects.toMatchObject({ code: "conflict" });
    await expect(applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "note", note: "  " })).rejects.toMatchObject({ code: "invalid" });
    const n = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "note", note: "Pediu retorno à tarde" });
    expect(n.entry!.status).toBeNull();
    expect(n.activities[0]).toMatchObject({ outcome: "note", note: "Pediu retorno à tarde" });
    await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    const r = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "note", note: "ok" });
    expect(r.currentStep?.key).toBe("ligacao-1");
  });

  it("parar limpa a cadência e set_step move para a etapa escolhida", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    const s = await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    const target = s.steps[3];
    const moved = await applyCadenceAction(ctx.seller, c.id, { action: "set_step", stepId: target.id });
    expect(moved.currentStep?.id).toBe(target.id);
    expect(moved.activities[0].outcome).toBe("step_changed");
    const stopped = await applyCadenceAction(ctx.seller, c.id, { action: "stop" });
    expect(stopped.entry).toMatchObject({ status: null, stepId: null, dueAt: null });
    expect(stopped.activities[0].outcome).toBe("stopped");
    const [row] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(row.nextAction).toBeNull();
  });

  it("parar não apaga uma próxima ação escrita à mão", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    await db.update(contacts).set({ nextAction: "Mandar proposta" }).where(eq(contacts.id, c.id));
    await applyCadenceAction(ctx.seller, c.id, { action: "stop" });
    const [row] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(row.nextAction).toBe("Mandar proposta");
  });

  it("vendedor não mexe no contato de outro (notFound)", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    await expect(applyCadenceAction(ctx.seller2, c.id, { action: "start" })).rejects.toMatchObject({ code: "not_found" });
    await expect(getContactCadence(ctx.seller2, c.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(getQueue(ctx.seller2, { view: "all", ownerId: ctx.seller.userId })).rejects.toMatchObject({ code: "forbidden" });
    await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    expect((await getQueue(ctx.seller2, { view: "all" })).items).toHaveLength(0);
    expect((await getQueue(ctx.manager, { view: "all" })).items).toHaveLength(1);
  });

  it("editar passos exige pipeline.edit, arquiva removidos e leads continuam andando", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    const before = await listActiveSteps(ctx.admin.orgId);
    const payload = (ids: (string | undefined)[]) => ({
      steps: ids.map((id, i) => ({ id, name: `Passo ${i + 1}`, channel: "whatsapp" as const, waitDays: i, script: "Oi {nome}" })),
    });
    await expect(saveSteps(ctx.seller, payload([before[0].id]))).rejects.toMatchObject({ code: "forbidden" });
    await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "call_no_answer" }); // em mensagem-1

    // mantém 1º e 3º, remove o 2º (onde o lead está) e cria um novo
    const after = await saveSteps(ctx.manager, payload([before[0].id, before[2].id, undefined]));
    expect(after.map((s) => s.name)).toEqual(["Passo 1", "Passo 2", "Passo 3"]);
    expect(after[2].key).toBe("passo-3");
    const archived = await db.select().from(cadenceSteps).where(eq(cadenceSteps.id, before[1].id));
    expect(archived[0].archivedAt).not.toBeNull();
    const view = await getContactCadence(ctx.seller, c.id);
    expect(view.currentStep?.id).toBe(before[1].id); // ainda aponta para o arquivado
    const next = await applyCadenceAction(ctx.seller, c.id, { action: "log", outcome: "message_sent" });
    expect(next.currentStep?.id).toBe(before[2].id);
    expect(() => saveStepsSchema.parse({ steps: [] })).toThrow();
  });

  it("fila: para hoje, próximos e contagens", async () => {
    const { ctx } = await setupOrg();
    const a = await leadFor(ctx.seller, "Atrasado");
    const b = await leadFor(ctx.seller, "Futuro");
    const d = await leadFor(ctx.seller, "Conversa");
    for (const x of [a, b, d]) await applyCadenceAction(ctx.seller, x.id, { action: "start" });
    await applyCadenceAction(ctx.seller, d.id, { action: "log", outcome: "replied" });
    await applyCadenceAction(ctx.seller, b.id, { action: "set_step", stepId: (await listActiveSteps(ctx.seller.orgId))[4].id });
    await db.update(relationshipEntries).set({ cadenceDueAt: new Date(Date.now() + 3 * 86_400_000) }).where(eq(relationshipEntries.contactId, b.id));
    await db.update(relationshipEntries).set({ cadenceDueAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(relationshipEntries.contactId, a.id));

    const due = await getQueue(ctx.seller, { view: "due" });
    expect(due.items.map((i) => i.name)).toEqual(["Atrasado"]);
    expect(due.items[0]).toMatchObject({ status: "active", stepName: "Ligação 1", stepChannel: "call", stepIndex: 1, stepCount: 6, ownerName: "Mariana" });
    expect(due.items[0].lastActivity).toMatchObject({ outcome: "started", actorName: "Mariana" });
    expect(due.counts).toEqual({ overdue: 1, today: 0, upcoming: 1, responded: 1, scheduled: 0, lost: 0, finished: 0 });
    expect((await getQueue(ctx.seller, { view: "upcoming" })).items.map((i) => i.name)).toEqual(["Futuro"]);
    expect((await getQueue(ctx.seller, { view: "responded" })).items.map((i) => i.name)).toEqual(["Conversa"]);
    expect((await getQueue(ctx.seller, { view: "all" })).items.map((i) => i.name)).toEqual(["Atrasado", "Futuro", "Conversa"]);
  });

  it("cartões do quadro trazem os dados da cadência", async () => {
    const { ctx } = await setupOrg();
    const c = await leadFor(ctx.seller);
    let card = (await getBoard(ctx.seller, {})).stages[0].cards.find((x) => x.contactId === c.id)!;
    expect(card).toMatchObject({ cadenceStatus: null, cadenceStepName: null, cadenceStepChannel: null, cadenceDueAt: null });
    await applyCadenceAction(ctx.seller, c.id, { action: "start" });
    card = (await getBoard(ctx.seller, {})).stages[0].cards.find((x) => x.contactId === c.id)!;
    expect(card).toMatchObject({ cadenceStatus: "active", cadenceStepName: "Ligação 1", cadenceStepChannel: "call" });
    expect(card.cadenceDueAt).not.toBeNull();
  });
});
