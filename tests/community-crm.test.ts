import { describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { communityEntries, leads, notifications, pipelines, pipelineStages, stageHistory } from "@/server/db/schema";
import { submitPublicForm, getLead, listLeads, forwardLeadToKanban } from "@/server/services/leads";
import { createForm } from "@/server/services/integrations";
import { addLeadsToCommunity, communityStatusFor, getCommunityBoard, moveCommunityEntry, removeCommunityEntry } from "@/server/services/community";
import { forwardToCloser, getCommercialBoard, getOpportunityDetail } from "@/server/services/commercial";
import { communityPipeline } from "@/server/services/common";
import { setupOrg } from "./helpers";

type Org = Awaited<ReturnType<typeof setupOrg>>;
const base = { consent: true as const, startedAt: Date.now() - 10_000 };
let seq = 0;

async function newLead(o: Org) {
  const form = await createForm(o.ctx.admin, { name: `Form ${++seq}`, headline: "Oi", questions: [] });
  await submitPublicForm(form.slug, { ...base, name: `Lead ${seq}`, phone: `7199${String(2000000 + seq)}` }, "1.1.1.1");
  const [l] = await db.select().from(leads).where(eq(leads.formId, form.id));
  return l;
}
const stageByKey = async (o: Org, key: string) => {
  const board = await getCommunityBoard(o.ctx.admin);
  return board.stages.find((s) => s.key === key)!;
};

describe("CRM da Comunidade", () => {
  it("cria o funil com as etapas padrão uma única vez, mesmo em chamadas simultâneas", async () => {
    const o = await setupOrg();
    await Promise.all([communityPipeline(o.org.id), communityPipeline(o.org.id), communityPipeline(o.org.id)]);
    const ps = await db.select().from(pipelines).where(and(eq(pipelines.orgId, o.org.id), eq(pipelines.kind, "community")));
    expect(ps).toHaveLength(1);
    const board = await getCommunityBoard(o.ctx.admin);
    expect(board.stages.map((s) => [s.key, s.name, s.color])).toEqual([
      ["novo", "Novo", "blue"],
      ["em-contato", "Em contato", "teal"],
      ["interessado", "Interessado", "yellow"],
      ["encaminhado-closer", "Encaminhado ao closer", "lilac"],
      ["entrou", "Entrou na comunidade", "green"],
      ["perdido", "Perdido", "gray"],
    ]);
    expect(board.cards).toEqual([]);
  });

  it("admin envia leads (repetido ignorado); o lead sai da aba comunidade e vira em contato", async () => {
    const o = await setupOrg();
    const a = await newLead(o);
    const b = await newLead(o);
    expect((await listLeads(o.ctx.admin, { status: "comunidade", page: 1 })).rows).toHaveLength(2);

    const r1 = await addLeadsToCommunity(o.ctx.admin, { leadIds: [a.id, a.id, b.id] });
    expect(r1).toEqual({ added: 2, skipped: 1 });
    const r2 = await addLeadsToCommunity(o.ctx.admin, { leadIds: [a.id] });
    expect(r2).toEqual({ added: 0, skipped: 1 });

    const tab = await listLeads(o.ctx.admin, { status: "comunidade", page: 1 });
    expect(tab.rows).toHaveLength(0);
    expect(tab.community.total).toBe(0);
    const [after] = await db.select().from(leads).where(eq(leads.id, a.id));
    expect(after.status).toBe("contacted");

    const all = await listLeads(o.ctx.admin, { status: "all", page: 1 });
    const row = all.rows.find((x) => x.id === a.id)!;
    expect(row.inCommunity).toBe(true);
    expect(row.communityStageName).toBe("Novo");

    const board = await getCommunityBoard(o.ctx.admin);
    const novo = board.stages.find((s) => s.key === "novo")!;
    expect(board.cards).toHaveLength(2);
    expect(board.cards[0]).toMatchObject({ stageId: novo.id, leadId: expect.any(String), contactName: expect.stringMatching(/^Lead/), closerName: null, opportunityId: null, version: 1 });
    expect(board.cards[0].enteredStageAt).not.toBeNull();
    const hist = await db.select().from(stageHistory).where(eq(stageHistory.entityType, "community"));
    expect(hist).toHaveLength(2);
    expect(hist[0].reason).toBe("Enviado para o CRM da Comunidade");
    expect((await getCommunityBoard(o.ctx.admin, { q: "zzzz" })).cards).toHaveLength(0);
  });

  it("seller e closer não acessam o CRM da Comunidade", async () => {
    const o = await setupOrg();
    const a = await newLead(o);
    for (const c of [o.ctx.seller, o.ctx.closer]) {
      await expect(getCommunityBoard(c)).rejects.toMatchObject({ code: "forbidden", message: "O CRM da Comunidade é só para administradores e gestores." });
      await expect(addLeadsToCommunity(c, { leadIds: [a.id] })).rejects.toMatchObject({ code: "forbidden" });
    }
    expect((await getCommunityBoard(o.ctx.manager)).stages).toHaveLength(6);
  });

  it("move com versão otimista, reordena e remove", async () => {
    const o = await setupOrg();
    const a = await newLead(o);
    const b = await newLead(o);
    await addLeadsToCommunity(o.ctx.admin, { leadIds: [a.id, b.id] });
    const [c1, c2] = (await getCommunityBoard(o.ctx.admin)).cards;
    const contato = await stageByKey(o, "em-contato");

    const moved = await moveCommunityEntry(o.ctx.admin, c1.id, { toStageId: contato.id, expectedVersion: c1.version });
    expect(moved).toMatchObject({ id: c1.id, stageId: contato.id, version: 2 });
    await expect(moveCommunityEntry(o.ctx.admin, c1.id, { toStageId: contato.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "conflict" });
    // Mover o outro cartão para antes do primeiro, na mesma etapa de destino.
    await moveCommunityEntry(o.ctx.admin, c2.id, { toStageId: contato.id, beforeId: c1.id, expectedVersion: c2.version });
    const cards = (await getCommunityBoard(o.ctx.admin)).cards.filter((c) => c.stageId === contato.id);
    expect(cards.map((c) => c.id)).toEqual([c2.id, c1.id]);

    await removeCommunityEntry(o.ctx.admin, c1.id);
    expect((await getCommunityBoard(o.ctx.admin)).cards.map((c) => c.id)).toEqual([c2.id]);
    expect(await communityStatusFor(o.org.id, c1.contactId)).toBeNull();
    const [closed] = await db.select().from(communityEntries).where(eq(communityEntries.id, c1.id));
    expect(closed.closedAt).not.toBeNull();
    // Fora da comunidade, o lead volta para a aba (continua em contato, sem dono).
    expect((await listLeads(o.ctx.admin, { status: "comunidade", page: 1 })).rows.map((r) => r.contactId)).toEqual([c1.contactId]);
  });

  it("soltar na coluna (toEnd) leva o cartão para o fim da etapa, inclusive na mesma etapa", async () => {
    const o = await setupOrg();
    const [a, b, c] = [await newLead(o), await newLead(o), await newLead(o)];
    await addLeadsToCommunity(o.ctx.admin, { leadIds: [a.id, b.id, c.id] });
    const novo = await stageByKey(o, "novo");
    const contato = await stageByKey(o, "em-contato");
    const ids = (await getCommunityBoard(o.ctx.admin)).cards.map((x) => x.id);
    const order = async (stageId: string) => (await getCommunityBoard(o.ctx.admin)).cards.filter((x) => x.stageId === stageId).map((x) => x.id);
    const version = async (id: string) => (await getCommunityBoard(o.ctx.admin)).cards.find((x) => x.id === id)!.version;

    // Mesma etapa: o primeiro vai para o fim.
    const r = await moveCommunityEntry(o.ctx.admin, ids[0], { toStageId: novo.id, toEnd: true, expectedVersion: await version(ids[0]) });
    expect(r.version).toBe(2);
    expect(await order(novo.id)).toEqual([ids[1], ids[2], ids[0]]);
    // Já é o último: nada muda (versão mantida).
    expect((await moveCommunityEntry(o.ctx.admin, ids[0], { toStageId: novo.id, toEnd: true, expectedVersion: 2 })).version).toBe(2);
    // Sem toEnd nem beforeId na mesma etapa continua sem efeito.
    expect((await moveCommunityEntry(o.ctx.admin, ids[1], { toStageId: novo.id, expectedVersion: await version(ids[1]) })).version).toBe(1);

    // Outra etapa: etapa vazia, depois o segundo entra no fim (e não no topo).
    await moveCommunityEntry(o.ctx.admin, ids[1], { toStageId: contato.id, toEnd: true, expectedVersion: await version(ids[1]) });
    await moveCommunityEntry(o.ctx.admin, ids[2], { toStageId: contato.id, toEnd: true, expectedVersion: await version(ids[2]) });
    expect(await order(contato.id)).toEqual([ids[1], ids[2]]);
    const hist = await db.select().from(stageHistory).where(and(eq(stageHistory.entityId, ids[2]), eq(stageHistory.toStageId, contato.id)));
    expect(hist).toHaveLength(1);
    // Sem toEnd continua indo para o topo.
    await moveCommunityEntry(o.ctx.admin, ids[0], { toStageId: contato.id, expectedVersion: await version(ids[0]) });
    expect(await order(contato.id)).toEqual([ids[0], ids[1], ids[2]]);
  });

  it("o cartão mostra o SDR dono do contato depois de encaminhar ao Kanban de um SDR", async () => {
    const o = await setupOrg();
    const a = await newLead(o);
    await addLeadsToCommunity(o.ctx.admin, { leadIds: [a.id] });
    expect((await getCommunityBoard(o.ctx.admin)).cards[0]).toMatchObject({ sdrId: null, sdrName: null });
    await forwardLeadToKanban(o.ctx.admin, a.id, { sdrId: o.users.seller.id });
    expect((await getCommunityBoard(o.ctx.admin)).cards[0]).toMatchObject({ sdrId: o.users.seller.id, sdrName: "Mariana" });
  });

  it("encaminhar ao closer move a entrada, avisa como Comunidade e marca o cartão e a ficha do closer", async () => {
    const o = await setupOrg();
    const a = await newLead(o);
    const b = await newLead(o);
    await addLeadsToCommunity(o.ctx.admin, { leadIds: [a.id] });

    const opp = await forwardToCloser(o.ctx.admin, a.contactId, { closerId: o.users.closer.id });
    const status = await communityStatusFor(o.org.id, a.contactId);
    expect(status).toMatchObject({ stageKey: "encaminhado-closer", stageName: "Encaminhado ao closer" });
    const card = (await getCommunityBoard(o.ctx.admin)).cards.find((c) => c.contactId === a.contactId)!;
    expect(card).toMatchObject({ closerName: "Carla", opportunityId: opp.id });

    const [note] = await db.select().from(notifications).where(and(eq(notifications.userId, o.users.closer.id), eq(notifications.type, "opportunity.forwarded")));
    expect(note.title).toBe("🔥 Novo Lead da Comunidade recebido");

    // Lead de fora da comunidade: sem selo e notificação normal.
    const opp2 = await forwardToCloser(o.ctx.admin, b.contactId, { closerId: o.users.closer.id });
    const board = await getCommercialBoard(o.ctx.closer, {});
    expect(board.cards.find((c) => c.id === opp.id)!.fromCommunity).toBe(true);
    expect(board.cards.find((c) => c.id === opp2.id)!.fromCommunity).toBe(false);
    expect((await getOpportunityDetail(o.ctx.closer, opp.id)).fromCommunity).toBe(true);
    expect((await getOpportunityDetail(o.ctx.closer, opp2.id)).fromCommunity).toBe(false);
    const notes = await db.select().from(notifications).where(and(eq(notifications.userId, o.users.closer.id), eq(notifications.type, "opportunity.forwarded")));
    expect(notes.map((n) => n.title).sort()).toEqual(["🔥 Novo Lead da Comunidade recebido", "🔥 Novo Lead recebido"]);

    expect((await getLead(o.ctx.closer, a.id)).fromCommunity).toBe(true);
    expect((await getLead(o.ctx.closer, b.id)).fromCommunity).toBe(false);
    expect(await db.select().from(pipelineStages).where(and(eq(pipelineStages.key, "encaminhado-closer"), isNull(pipelineStages.archivedAt)))).toHaveLength(2); // funil do SDR + da comunidade
  });
});
