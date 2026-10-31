import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { contacts, leads, notifications, pipelineStages, relationshipEntries, stageHistory } from "@/server/db/schema";
import { forwardLeadToKanban, getLead, listLeads, newLeadCount, submitPublicForm } from "@/server/services/leads";
import { listSdrBoards } from "@/server/services/board";
import { listStages } from "@/server/services/stages";
import { addToBoard } from "@/server/services/board";
import { createForm } from "@/server/services/integrations";
import { CONTATO_KEY } from "@/server/services/common";
import { setupOrg } from "./helpers";

type Org = Awaited<ReturnType<typeof setupOrg>>;
const base = { consent: true as const, startedAt: Date.now() - 10_000 };
let seq = 0;

/** Cria um lead pelo formulário público e entrega ao usuário (responsável do lead e dono do contato). */
async function leadFor(o: Org, ownerId: string) {
  const form = await createForm(o.ctx.admin, { name: `Form ${++seq}`, headline: "Oi", questions: [] });
  await submitPublicForm(form.slug, { ...base, name: `Lead ${seq}`, phone: `7199${String(1000000 + seq)}` }, "1.1.1.1");
  const [l] = await db.select().from(leads).where(eq(leads.formId, form.id));
  await db.update(leads).set({ assignedTo: ownerId }).where(eq(leads.id, l.id));
  await db.update(contacts).set({ ownerId }).where(eq(contacts.id, l.contactId));
  return (await db.select().from(leads).where(eq(leads.id, l.id)))[0];
}
const entryOf = async (contactId: string) => (await db.select().from(relationshipEntries).where(and(eq(relationshipEntries.contactId, contactId), isNull(relationshipEntries.closedAt))))[0];

describe("Kanban por SDR", () => {
  it("migração/padrão: a etapa Contato é a primeira coluna do funil", async () => {
    const o = await setupOrg();
    const stages = await listStages(o.ctx.admin, "relationship");
    expect(stages[0]).toMatchObject({ key: CONTATO_KEY, name: "Contato", color: "blue" });
    expect(stages).toHaveLength(8);
  });

  it("seller encaminha: cartão em Contato, dono, responsável, status e abas", async () => {
    const o = await setupOrg();
    const l = await leadFor(o, o.users.seller.id);
    expect((await listLeads(o.ctx.seller, { status: "open", page: 1 })).rows.map((r) => r.id)).toContain(l.id);
    const before = await newLeadCount(o.ctx.seller);

    const r = await forwardLeadToKanban(o.ctx.seller, l.id, {});
    expect(r).toMatchObject({ stageName: "Contato", sdrId: o.users.seller.id, sdrName: "Mariana" });

    const e = await entryOf(l.contactId);
    expect(e).toMatchObject({ id: r.entryId, stageId: r.stageId, autoCreated: false, origin: "form" });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, l.contactId));
    expect(c.ownerId).toBe(o.users.seller.id);
    const [u] = await db.select().from(leads).where(eq(leads.id, l.id));
    expect(u).toMatchObject({ assignedTo: o.users.seller.id, status: "contacted" });
    expect(u.contactedAt).not.toBeNull();

    const open = await listLeads(o.ctx.seller, { status: "open", page: 1 });
    expect(open.rows.map((x) => x.id)).not.toContain(l.id);
    expect(open.topCount).toBe(0);
    const kanban = await listLeads(o.ctx.seller, { status: "kanban", page: 1 });
    expect(kanban.rows).toHaveLength(1);
    expect(kanban.rows[0]).toMatchObject({ id: l.id, boardOwnerName: "Mariana", boardStageName: "Contato" });
    expect(kanban.counts.kanban).toBe(1);
    expect(kanban.counts.contacted ?? 0).toBe(0);
    const all = await listLeads(o.ctx.seller, { status: "all", page: 1 });
    expect(all.rows.map((x) => x.id)).toContain(l.id);
    expect(all.allCount).toBe(1);
    expect(await newLeadCount(o.ctx.seller)).toBe(before - 1);

    const detail = await getLead(o.ctx.seller, l.id);
    expect(detail.board).toMatchObject({ inBoard: true, stageName: "Contato", ownerId: o.users.seller.id, ownerName: "Mariana", contatoStageId: r.stageId });
    const hist = await db.select().from(stageHistory).where(eq(stageHistory.contactId, l.contactId));
    expect(hist[0].reason).toMatch(/^Encaminhado para o Kanban de Mariana · /);
  });

  it("admin encaminha para outro seller e avisa; seller não pode encaminhar para outro", async () => {
    const o = await setupOrg();
    const l = await leadFor(o, o.users.seller.id);
    await expect(forwardLeadToKanban(o.ctx.seller, l.id, { sdrId: o.users.seller2.id })).rejects.toMatchObject({ code: "forbidden", message: "Somente gestores encaminham para o Kanban de outra pessoa." });
    expect(await entryOf(l.contactId)).toBeUndefined();

    const r = await forwardLeadToKanban(o.ctx.admin, l.id, { sdrId: o.users.seller2.id });
    expect(r.sdrName).toBe("Rafael");
    const [c] = await db.select().from(contacts).where(eq(contacts.id, l.contactId));
    expect(c.ownerId).toBe(o.users.seller2.id);
    const notes = await db.select().from(notifications).where(eq(notifications.userId, o.users.seller2.id));
    expect(notes.find((n) => n.title === `Lead no seu Kanban: ${l.name}`)?.link).toBe(`/social-seller?responsavel=${o.users.seller2.id}`);
    // admin também pode encaminhar para o próprio Kanban
    const l2 = await leadFor(o, o.users.seller.id);
    expect((await forwardLeadToKanban(o.ctx.admin, l2.id, {})).sdrName).toBe("Admin");
  });

  it("seller não toma o contato de outro SDR mesmo sem cartão no Kanban", async () => {
    const o = await setupOrg();
    const l = await leadFor(o, o.users.seller.id);
    await db.update(contacts).set({ ownerId: o.users.seller.id }).where(eq(contacts.id, l.contactId));
    await db.update(leads).set({ assignedTo: o.users.seller2.id }).where(eq(leads.id, l.id)); // visível para o seller2
    await expect(forwardLeadToKanban(o.ctx.seller2, l.id, {})).rejects.toMatchObject({ code: "conflict", message: "Este contato é de Mariana. Peça a um gestor para encaminhar." });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, l.contactId));
    expect(c.ownerId).toBe(o.users.seller.id);
    expect(await entryOf(l.contactId)).toBeUndefined();
  });

  it("seller não toma lead que já está no Kanban de outro SDR; gestor reencaminha", async () => {
    const o = await setupOrg();
    const l = await leadFor(o, o.users.seller.id);
    await forwardLeadToKanban(o.ctx.seller, l.id, {});
    await db.update(leads).set({ assignedTo: o.users.seller2.id }).where(eq(leads.id, l.id)); // visível para o seller2
    await expect(forwardLeadToKanban(o.ctx.seller2, l.id, {})).rejects.toMatchObject({ code: "conflict", message: "Este lead já está no Kanban de Mariana." });
    await forwardLeadToKanban(o.ctx.manager, l.id, { sdrId: o.users.seller2.id });
    expect((await entryOf(l.contactId))).toBeDefined();
    const boards = await listSdrBoards(o.ctx.admin);
    expect(boards.find((b) => b.userId === o.users.seller2.id)?.total).toBe(1);
  });

  it("closer, inativo e etapa de outro funil são recusados", async () => {
    const o = await setupOrg();
    const l = await leadFor(o, o.users.seller.id);
    await expect(forwardLeadToKanban(o.ctx.admin, l.id, { sdrId: o.users.closer.id })).rejects.toMatchObject({ code: "invalid", message: "Escolha um SDR da equipe." });
    await expect(forwardLeadToKanban(o.ctx.admin, l.id, { sdrId: crypto.randomUUID() })).rejects.toMatchObject({ code: "invalid" });
    const [sales] = await db.select().from(pipelineStages).where(eq(pipelineStages.key, "qualificacao"));
    await expect(forwardLeadToKanban(o.ctx.seller, l.id, { stageId: sales.id })).rejects.toMatchObject({ code: "invalid" });
    expect(await entryOf(l.contactId)).toBeUndefined();
  });

  it("cartão automático é promovido e movido para Contato; etapa escolhida vale", async () => {
    const o = await setupOrg();
    const stages = await listStages(o.ctx.admin, "relationship");
    const engajado = stages.find((s) => s.key === "engajado-1")!;
    const l = await leadFor(o, o.users.seller.id);
    const auto = await addToBoard(o.ctx.seller, l.contactId, engajado.id);
    await db.update(relationshipEntries).set({ autoCreated: true }).where(eq(relationshipEntries.id, auto!.id));
    expect((await listLeads(o.ctx.seller, { status: "open", page: 1 })).rows.map((x) => x.id)).toContain(l.id); // automático não tira de Leads

    const r = await forwardLeadToKanban(o.ctx.seller, l.id, {});
    expect(r.entryId).toBe(auto!.id);
    const e = await entryOf(l.contactId);
    expect(e).toMatchObject({ stageId: stages[0].id, autoCreated: false, version: 2 });

    const l2 = await leadFor(o, o.users.seller.id);
    const r2 = await forwardLeadToKanban(o.ctx.seller, l2.id, { stageId: engajado.id });
    expect(r2.stageName).toBe("Engajado #1");
  });

  it("listSdrBoards conta por dono, próprio primeiro; seller só vê o seu", async () => {
    const o = await setupOrg();
    for (let i = 0; i < 2; i++) await forwardLeadToKanban(o.ctx.seller, (await leadFor(o, o.users.seller.id)).id, {});
    await forwardLeadToKanban(o.ctx.admin, (await leadFor(o, o.users.seller.id)).id, { sdrId: o.users.seller2.id });

    const adm = await listSdrBoards(o.ctx.admin);
    expect(adm.map((b) => b.name)).toEqual(["Admin", "Gestora", "Mariana", "Rafael"]);
    expect(adm.map((b) => b.total)).toEqual([0, 0, 2, 1]);
    expect(adm[0]).toMatchObject({ userId: o.users.admin.id, role: "admin" });
    expect(adm.some((b) => b.userId === o.users.closer.id)).toBe(false);
    const own = await listSdrBoards(o.ctx.seller);
    expect(own).toEqual([expect.objectContaining({ userId: o.users.seller.id, total: 2, role: "seller" })]);
  });
});
