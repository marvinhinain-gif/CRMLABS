import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { contacts, conversations, messages, notes, relationshipEntries, stageHistory } from "@/server/db/schema";
import { setupOrg } from "./helpers";
import { createContact } from "@/server/services/contacts";
import { listStages } from "@/server/services/stages";
import { getBoard, moveEntry } from "@/server/services/board";
import { applyCadenceAction } from "@/server/services/cadence";
import { getBoardCleanupPreview, runBoardCleanup } from "@/server/services/boardCleanup";

async function setup() {
  const o = await setupOrg();
  const [s1, s2] = await listStages(o.ctx.admin, "relationship");
  return { ...o, s1, s2 };
}

describe("Limpeza do quadro", () => {
  it("lista sem responsável e sem interação; mantém quem tem dono e interação", async () => {
    const { ctx, users, s1, s2 } = await setup();
    const noOwner = await createContact(ctx.admin, { name: "A Sem dono", stageId: s1.id });
    await db.update(contacts).set({ ownerId: null }).where(eq(contacts.id, noOwner.id));
    const idle = await createContact(ctx.seller, { name: "B Parado", stageId: s1.id });
    const withNote = await createContact(ctx.seller, { name: "C Nota", stageId: s1.id });
    await db.insert(notes).values({ orgId: ctx.seller.orgId, contactId: withNote.id, authorId: users.seller.id, body: "oi" });
    const withOut = await createContact(ctx.seller, { name: "D Msg", stageId: s1.id });
    const [cv] = await db.insert(conversations).values({ orgId: ctx.seller.orgId, contactId: withOut.id }).returning();
    await db.insert(messages).values({ orgId: ctx.seller.orgId, conversationId: cv.id, direction: "out", status: "accepted", body: "olá" });
    const withIn = await createContact(ctx.seller, { name: "E So recebeu", stageId: s1.id });
    const [cv2] = await db.insert(conversations).values({ orgId: ctx.seller.orgId, contactId: withIn.id }).returning();
    await db.insert(messages).values({ orgId: ctx.seller.orgId, conversationId: cv2.id, direction: "in", status: "received", body: "olá" });
    const moved = await createContact(ctx.seller, { name: "F Movido", stageId: s1.id });
    const card = (await getBoard(ctx.seller, {})).stages[0].cards.find((c) => c.contactId === moved.id)!;
    await moveEntry(ctx.seller, card.entryId, { toStageId: s2.id, expectedVersion: card.version });
    const cad = await createContact(ctx.seller, { name: "G Cadência", stageId: s1.id });
    await applyCadenceAction(ctx.seller, cad.id, { action: "start" });

    const p = await getBoardCleanupPreview(ctx.admin);
    const byName = Object.fromEntries(p.items.map((i) => [i.name, i.reason]));
    expect(byName).toEqual({ "A Sem dono": "sem_responsavel", "B Parado": "sem_interacao", "E So recebeu": "sem_interacao" });
    expect(p.total).toBe(3);
    expect(p.byStage).toEqual([expect.objectContaining({ stageId: s1.id, count: 3 })]);
    expect(idle.id).toBeTruthy();
  });

  it("POST fecha só os candidatos, grava histórico e não toca contato", async () => {
    const { ctx, users, s1 } = await setup();
    const idle = await createContact(ctx.seller, { name: "Parado", stageId: s1.id });
    const keep = await createContact(ctx.seller, { name: "Fica", stageId: s1.id });
    await db.insert(notes).values({ orgId: ctx.seller.orgId, contactId: keep.id, authorId: users.seller.id, body: "x" });
    await expect(runBoardCleanup(ctx.admin, { expectedTotal: 5 })).rejects.toMatchObject({ code: "conflict" });
    expect(await runBoardCleanup(ctx.admin, { expectedTotal: 1 })).toEqual({ removed: 1 });
    const [e] = await db.select().from(relationshipEntries).where(eq(relationshipEntries.contactId, idle.id));
    expect(e.closedAt).not.toBeNull();
    const [k] = await db.select().from(relationshipEntries).where(eq(relationshipEntries.contactId, keep.id));
    expect(k.closedAt).toBeNull();
    const hist = await db.select().from(stageHistory).where(eq(stageHistory.contactId, idle.id));
    expect(hist.at(-1)).toMatchObject({ toStageId: null, fromStageId: s1.id, actorId: users.admin.id, reason: "Limpeza do quadro: sem responsável ou sem conversa" });
    const [c] = await db.select().from(contacts).where(eq(contacts.id, idle.id));
    expect(c.ownerId).toBe(users.seller.id);
    expect((await getBoardCleanupPreview(ctx.admin)).total).toBe(0);
  });

  it("somente administrador (rota usa org.settings)", async () => {
    const { can } = await import("@/server/permissions");
    const { ctx } = await setup();
    expect(can(ctx.admin, "org.settings")).toBe(true);
    expect(can(ctx.manager, "org.settings")).toBe(false);
    expect(can(ctx.seller, "org.settings")).toBe(false);
  });
});
