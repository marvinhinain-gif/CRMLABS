import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, getSql } from "@/server/db";
import { contacts, relationshipEntries, stageHistory } from "@/server/db/schema";
import { setupOrg } from "./helpers";
import { createContact, mergeContacts, previewImport, commitImport, getContactDetail } from "@/server/services/contacts";
import { addEntry, getBoard, moveEntry } from "@/server/services/board";
import { archiveStage, createStage, listStages, reorderStages, updateStage } from "@/server/services/stages";

describe("Kanban de relacionamento", () => {
  it("mover persiste e registra histórico com autor, etapa anterior e nova", async () => {
    const { ctx, users } = await setupOrg();
    const [s1, s2] = await listStages(ctx.admin, "relationship");
    const c = await createContact(ctx.seller, { name: "Ana", stageId: s1.id });
    const card = (await getBoard(ctx.seller, {})).stages[0].cards[0];
    const moved = await moveEntry(ctx.seller, card.entryId, { toStageId: s2.id, expectedVersion: card.version });
    expect(moved.version).toBe(2);
    const board = await getBoard(ctx.seller, {});
    expect(board.stages.find((s) => s.id === s2.id)!.cards.map((x) => x.contactId)).toEqual([c.id]);
    const hist = await db.select().from(stageHistory).where(eq(stageHistory.contactId, c.id)).orderBy(stageHistory.createdAt);
    expect(hist).toHaveLength(2);
    expect(hist[1]).toMatchObject({ fromStageId: s1.id, toStageId: s2.id, actorId: users.seller.id, fromStageName: "Engajado #1", toStageName: "Seguidor Engajado #2" });
  });

  it("conflito: não sobrescreve silenciosamente a mudança de um colega", async () => {
    const { ctx } = await setupOrg();
    const [s1, s2, s3] = await listStages(ctx.admin, "relationship");
    await createContact(ctx.manager, { name: "Pedro", stageId: s1.id });
    const card = (await getBoard(ctx.manager, {})).stages[0].cards[0];
    await moveEntry(ctx.manager, card.entryId, { toStageId: s2.id, expectedVersion: 1 });
    await expect(moveEntry(ctx.admin, card.entryId, { toStageId: s3.id, expectedVersion: 1 })).rejects.toMatchObject({
      code: "conflict",
      details: { currentStageId: s2.id, currentVersion: 2 },
    });
  });

  it("histórico é imutável no banco", async () => {
    const { ctx } = await setupOrg();
    const [s1] = await listStages(ctx.admin, "relationship");
    await createContact(ctx.admin, { name: "X", stageId: s1.id });
    const sql = getSql();
    await expect(sql`update stage_history set to_stage_name = 'adulterado'`).rejects.toThrow(/imutável/);
    await expect(sql`delete from stage_history`).rejects.toThrow(/imutável/);
  });

  it("no máximo uma entrada ativa por funil", async () => {
    const { ctx } = await setupOrg();
    const [s1, s2] = await listStages(ctx.admin, "relationship");
    const c = await createContact(ctx.admin, { name: "Y", stageId: s1.id });
    await expect(addEntry(ctx.admin, { contactId: c.id, stageId: s2.id })).rejects.toMatchObject({ code: "conflict" });
  });

  it("editar e reordenar etapas persiste; nomes aprovados por padrão", async () => {
    const { ctx } = await setupOrg();
    const stages = await listStages(ctx.admin, "relationship");
    expect(stages.map((s) => s.name)).toEqual(["Engajado #1", "Seguidor Engajado #2", "Em relacionamento", "Novo interessado", "Em qualificação", "Encaminhado ao closer"]);
    await updateStage(ctx.manager, stages[2].id, { name: "Conversando", color: "orange" });
    await reorderStages(ctx.manager, "relationship", [stages[1].id, stages[0].id, ...stages.slice(2).map((s) => s.id)]);
    const after = await listStages(ctx.admin, "relationship");
    expect(after[0].id).toBe(stages[1].id);
    expect(after[2]).toMatchObject({ name: "Conversando", color: "orange", key: "em-relacionamento" });
    const created = await createStage(ctx.admin, { kind: "relationship", name: "Pós-venda", color: "teal" });
    expect((await listStages(ctx.admin, "relationship")).at(-1)!.id).toBe(created.id);
  });

  it("arquivar etapa ocupada exige destino e não apaga contatos", async () => {
    const { ctx } = await setupOrg();
    const [s1, s2] = await listStages(ctx.admin, "relationship");
    const a = await createContact(ctx.admin, { name: "A", stageId: s1.id });
    const b = await createContact(ctx.admin, { name: "B", stageId: s1.id });
    await expect(archiveStage(ctx.admin, s1.id)).rejects.toMatchObject({ code: "invalid", details: { occupied: 2 } });
    await archiveStage(ctx.admin, s1.id, s2.id);
    const stages = await listStages(ctx.admin, "relationship");
    expect(stages.find((s) => s.id === s1.id)).toBeUndefined();
    const entries = await db.select().from(relationshipEntries).where(eq(relationshipEntries.stageId, s2.id));
    expect(entries.map((e) => e.contactId).sort()).toEqual([a.id, b.id].sort());
    expect(await db.select().from(contacts)).toHaveLength(2);
    const hist = await db.select().from(stageHistory).where(and(eq(stageHistory.toStageId, s2.id), eq(stageHistory.reason, "Etapa arquivada")));
    expect(hist).toHaveLength(2);
  });

  it("contato manual sem identidade oficial não é marcado como verificado", async () => {
    const { ctx } = await setupOrg();
    const c = await createContact(ctx.admin, { name: "Manual", username: "@alguem" });
    const d = await getContactDetail(ctx.admin, c.id);
    expect(d.identities).toHaveLength(0);
    expect(d.contact.username).toBe("alguem");
  });
});

describe("Contatos: importação e mesclagem", () => {
  it("prévia valida por linha e aponta duplicidades; importação respeita o relatório", async () => {
    const { ctx } = await setupOrg();
    await createContact(ctx.admin, { name: "Ana Souza", username: "anasouza" });
    const csv = "nome,instagram,email\nAna S,@anasouza,\nBruno Costa,brunocosta,bruno@x.com\n,semnome,\nJulia,juliaalves,email-invalido\nBruno 2,brunocosta,";
    const p = await previewImport(ctx.admin, csv);
    expect(p.summary).toMatchObject({ total: 5, valid: 1, invalid: 2, duplicates: 2 });
    const r = await commitImport(ctx.admin, { csv });
    expect(r).toMatchObject({ created: 1, skippedInvalid: 2, skippedDuplicate: 2 });
    await expect(previewImport(ctx.seller, csv)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("mesclagem é explícita, preserva histórico e não duplica entradas", async () => {
    const { ctx } = await setupOrg();
    const [s1, s2] = await listStages(ctx.admin, "relationship");
    const a = await createContact(ctx.admin, { name: "Ana Souza", stageId: s1.id });
    const b = await createContact(ctx.admin, { name: "Ana S.", email: "ana@x.com", stageId: s2.id, force: true });
    await mergeContacts(ctx.admin, a.id, b.id);
    const d = await getContactDetail(ctx.admin, a.id);
    expect(d.contact.email).toBe("ana@x.com");
    expect(d.entry?.stageId).toBe(s1.id);
    expect(d.history.some((h) => h.reason?.startsWith("Mesclado"))).toBe(true);
    await expect(getContactDetail(ctx.admin, b.id)).resolves.toBeTruthy(); // registro preservado, arquivado
    const board = await getBoard(ctx.admin, {});
    expect(board.stages.flatMap((s) => s.cards)).toHaveLength(1);
    await expect(mergeContacts(ctx.seller, a.id, b.id)).rejects.toMatchObject({ code: "forbidden" });
  });
});
