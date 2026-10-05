import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { conversations, organizations } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { setupOrg, refreshCtx } from "./helpers";
import { createContact, getContactDetail, listContacts, updateContact } from "@/server/services/contacts";
import { getBoard, moveEntry } from "@/server/services/board";
import { listStages, createStage } from "@/server/services/stages";
import { createOpportunity, listOpportunities } from "@/server/services/commercial";
import { listConversations } from "@/server/services/conversations";
import { createTask, listTasks } from "@/server/services/tasks";
import { startConnect } from "@/server/integrations/instagram/oauth";
import { canReceive } from "@/server/realtime";
import { getDashboard } from "@/server/services/dashboard";

describe("permissões e isolamento", () => {
  it("seller não lê contatos de outro seller por lista, detalhe, quadro ou mutação", async () => {
    const { ctx, users } = await setupOrg();
    const [stage] = await listStages(ctx.admin, "relationship");
    const mine = await createContact(ctx.seller, { name: "Ana Souza", username: "@anasouza", stageId: stage.id });
    const other = await createContact(ctx.manager, { name: "Pedro Lima", ownerId: users.seller2.id, stageId: stage.id });

    const list = await listContacts(ctx.seller, { page: 1, pageSize: 25 });
    expect(list.rows.map((r) => r.id)).toEqual([mine.id]);
    await expect(getContactDetail(ctx.seller, other.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(updateContact(ctx.seller, other.id, { name: "hack" })).rejects.toMatchObject({ code: "not_found" });

    const board = await getBoard(ctx.seller, {});
    const ids = board.stages.flatMap((s) => s.cards.map((c) => c.contactId));
    expect(ids).toEqual([mine.id]);

    const otherEntry = (await getBoard(ctx.admin, {})).stages.flatMap((s) => s.cards).find((c) => c.contactId === other.id)!;
    await expect(moveEntry(ctx.seller, otherEntry.entryId, { toStageId: stage.id, expectedVersion: 1 })).rejects.toMatchObject({ code: "not_found" });
  });

  it("seller não pode atribuir contatos a outras pessoas; gestor pode", async () => {
    const { ctx, users } = await setupOrg();
    await expect(createContact(ctx.seller, { name: "X", ownerId: users.seller2.id })).rejects.toMatchObject({ code: "forbidden" });
    const c = await createContact(ctx.manager, { name: "Y", ownerId: users.seller2.id });
    expect(c.ownerId).toBe(users.seller2.id);
    const own = await createContact(ctx.seller, { name: "Z" });
    expect(own.ownerId).toBe(users.seller.id);
  });

  it("closer vê o contato quando recebe a oportunidade", async () => {
    const { ctx, users } = await setupOrg();
    const c = await createContact(ctx.seller, { name: "Camila" });
    await expect(getContactDetail(ctx.closer, c.id)).rejects.toMatchObject({ code: "not_found" });
    await createOpportunity(ctx.seller, { contactId: c.id, title: "Consultoria", valueCents: 500000, closerId: users.closer.id });
    await expect(getContactDetail(ctx.closer, c.id)).resolves.toBeTruthy();
    expect((await listOpportunities(ctx.closer, { status: "open" })).rows).toHaveLength(1);
    expect((await listOpportunities(ctx.seller2, { status: "open" })).rows).toHaveLength(0);
  });

  it("estrutura do funil só é editável por administrador/gestor", async () => {
    const { ctx } = await setupOrg();
    await expect(createStage(ctx.seller, { kind: "relationship", name: "Nova", color: "green" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(createStage(ctx.manager, { kind: "relationship", name: "Nova", color: "green" })).resolves.toBeTruthy();
  });

  it("apenas administrador conecta contas", async () => {
    const { ctx } = await setupOrg();
    await expect(startConnect(ctx.manager)).rejects.toMatchObject({ code: "forbidden" });
    await expect(startConnect(ctx.admin)).resolves.toMatch(/^https:\/\/www\.instagram\.com\/oauth\/authorize\?/);
  });

  it("organizações são isoladas", async () => {
    const a = await setupOrg("A");
    const b = await setupOrg("B");
    const c = await createContact(a.ctx.admin, { name: "Segredo de A" });
    await expect(getContactDetail(b.ctx.admin, c.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await listContacts(b.ctx.admin, { page: 1, pageSize: 25 })).total).toBe(0);
    expect(canReceive(b.ctx.admin, { orgId: a.org.id, topic: "contacts" })).toBe(false);
  });

  it("tempo real entrega eventos só a quem pode ver", async () => {
    const { ctx, org, users } = await setupOrg();
    const e = { orgId: org.id, topic: "board" as const, ownerIds: [users.seller.id] };
    expect(canReceive(ctx.seller, e)).toBe(true);
    expect(canReceive(ctx.seller2, e)).toBe(false);
    expect(canReceive(ctx.manager, e)).toBe(true);
    expect(canReceive(ctx.seller, { orgId: org.id, topic: "notifications", userId: users.seller2.id })).toBe(false);
    expect(canReceive(ctx.seller, { orgId: org.id, topic: "settings", managersOnly: true })).toBe(false);
  });

  it("caixa compartilhada libera conversas sem responsável para sellers", async () => {
    const { ctx, org } = await setupOrg();
    const c = await createContact(ctx.manager, { name: "Sem dono", ownerId: null });
    await db.insert(conversations).values({ orgId: org.id, contactId: c.id, channel: "instagram" });
    expect((await listConversations(ctx.seller, { filter: "all", limit: 30 })).rows).toHaveLength(0);
    await db.update(organizations).set({ sharedInbox: true }).where(eq(organizations.id, org.id));
    const sellerShared = await refreshCtx(ctx.seller);
    expect((await listConversations(sellerShared, { filter: "all", limit: 30 })).rows).toHaveLength(1);
  });

  it("tarefas e dashboard respeitam o escopo", async () => {
    const { ctx, users } = await setupOrg();
    await createTask(ctx.manager, { title: "Do seller 2", ownerId: users.seller2.id, dueAt: new Date() });
    await createTask(ctx.seller, { title: "Minha", dueAt: new Date() });
    expect((await listTasks(ctx.seller, { view: "today", limit: 50 })).map((t) => t.title)).toEqual(["Minha"]);
    // Qualquer pessoa da equipe atribui tarefas (ex.: social seller → closer) e acompanha o que atribuiu.
    await createTask(ctx.seller, { title: "Para outro", ownerId: users.seller2.id });
    expect((await listTasks(ctx.seller2, { view: "upcoming", limit: 50 })).map((t) => t.title)).toEqual(["Para outro"]);
    expect((await listTasks(ctx.seller, { view: "upcoming", limit: 50 })).map((t) => t.title)).toEqual(["Para outro"]);
    await expect(getDashboard(ctx.seller, { period: "month", ownerId: users.seller2.id })).rejects.toMatchObject({ code: "forbidden" });
  });
});
