import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditEvents, sessions } from "@/server/db/schema";
import { login, resolveSession, revokeSession } from "@/server/auth/service";
import { createContact, addNote } from "@/server/services/contacts";
import { getBoard, moveEntry } from "@/server/services/board";
import { listStages } from "@/server/services/stages";
import { listTeamActivity, teamActivitySummary } from "@/server/services/activity";
import { activityCategory, activityDetail, deviceLabel } from "@/lib/activity";
import { createOrganization } from "@/server/services/common";
import { makeUser, setupOrg } from "./helpers";

const PW = "senha-forte-123";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const actionsOf = (orgId: string, userId: string) =>
  db
    .select({ action: auditEvents.action, data: auditEvents.data })
    .from(auditEvents)
    .where(and(eq(auditEvents.orgId, orgId), eq(auditEvents.actorId, userId)))
    .orderBy(auditEvents.createdAt);

describe("histórico de acessos da equipe", () => {
  it("registra entrada com aparelho e IP, senha errada e saída", async () => {
    const org = await createOrganization({ name: "AXION" });
    const seller = await makeUser(org.id, "seller", { password: PW, name: "Mariana" });
    await expect(login({ email: seller.email, password: "senha-errada-1", remember: false, ip: "10.0.0.9", userAgent: IPHONE })).rejects.toThrow();
    const r = await login({ email: seller.email, password: PW, remember: true, ip: "10.0.0.9", userAgent: IPHONE });
    await revokeSession(r.token);
    const rows = await actionsOf(org.id, seller.id);
    expect(rows.map((x) => x.action)).toEqual(["auth.login_failed", "auth.login", "auth.logout"]);
    expect(rows[1].data).toMatchObject({ ip: "10.0.0.9", device: "iPhone · Safari", remember: true });
  });

  it("e-mail inexistente não gera registro", async () => {
    await createOrganization({ name: "AXION" });
    await expect(login({ email: "ninguem@x.com", password: PW, remember: false })).rejects.toThrow();
    expect(await db.select().from(auditEvents).where(eq(auditEvents.action, "auth.login_failed"))).toHaveLength(0);
  });

  it("volta ao CRM depois de um tempo parado conta como acesso (uma vez só)", async () => {
    const org = await createOrganization({ name: "AXION" });
    const seller = await makeUser(org.id, "seller", { password: PW });
    const r = await login({ email: seller.email, password: PW, remember: true, userAgent: IPHONE });
    // Uso contínuo não gera registro novo.
    await resolveSession(r.token);
    expect((await actionsOf(org.id, seller.id)).map((x) => x.action)).toEqual(["auth.login"]);
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 2 * 60 * 60 * 1000) }).where(eq(sessions.userId, seller.id));
    // Várias requisições juntas ao reabrir: só uma registra.
    await Promise.all([resolveSession(r.token), resolveSession(r.token), resolveSession(r.token)]);
    const rows = await actionsOf(org.id, seller.id);
    expect(rows.map((x) => x.action)).toEqual(["auth.login", "auth.session_resumed"]);
    expect(rows[1].data).toMatchObject({ device: "iPhone · Safari" });
  });
});

describe("atividade da equipe", () => {
  it("mostra o que cada pessoa fez, com filtro por pessoa e tipo", async () => {
    const { ctx, users } = await setupOrg();
    const [s1, s2] = await listStages(ctx.admin, "relationship");
    const c = await createContact(ctx.seller, { name: "Ana Cliente", stageId: s1.id });
    const card = (await getBoard(ctx.seller, {})).stages.find((s) => s.id === s1.id)!.cards[0];
    await moveEntry(ctx.seller, card.entryId, { toStageId: s2.id, expectedVersion: card.version });
    await addNote(ctx.seller2, c.id, "Ligar amanhã").catch(() => {}); // seller2 não vê o contato
    await addNote(ctx.admin, c.id, "Cliente quente");

    const all = await listTeamActivity(ctx.admin, { periodo: "today" });
    const moved = all.items.find((i) => i.action === "board.card_moved")!;
    expect(moved).toMatchObject({ actorId: users.seller.id, actorName: "Mariana", contactId: c.id, contactName: "Ana Cliente" });
    expect(activityDetail(moved.action, moved.data as Record<string, unknown>)).toBe(`${s1.name} → ${s2.name}`);

    const onlySeller = await listTeamActivity(ctx.admin, { periodo: "today", pessoa: users.seller.id });
    expect(onlySeller.items.every((i) => i.actorId === users.seller.id)).toBe(true);
    expect(onlySeller.items.map((i) => i.action)).toContain("contact.created");

    const leads = await listTeamActivity(ctx.admin, { periodo: "today", tipo: "leads" });
    expect(leads.items.map((i) => i.action)).toEqual(["board.card_moved"]);
    const contactsCat = await listTeamActivity(ctx.admin, { periodo: "today", tipo: "contacts" });
    expect(contactsCat.items.map((i) => i.action).sort()).toEqual(["contact.created", "contact.note_added"]);

    const summary = await teamActivitySummary(ctx.admin, { periodo: "today" });
    const mariana = summary.find((m) => m.userId === users.seller.id)!;
    expect(mariana.actions).toBe(2);
    expect(mariana.openSessions).toBe(1);
    expect(summary.find((m) => m.userId === users.seller2.id)!.actions).toBe(0);
  });

  it("pagina sem pular nem repetir eventos", async () => {
    const { org, ctx, users } = await setupOrg();
    const same = new Date();
    await db.insert(auditEvents).values(Array.from({ length: 120 }, (_, i) => ({ orgId: org.id, actorId: users.seller.id, action: "task.completed", entityType: "task", entityId: null, createdAt: i < 60 ? same : new Date(same.getTime() - i * 1000) })));
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let i = 0; i < 5; i++) {
      const page = await listTeamActivity(ctx.admin, { periodo: "today", pessoa: users.seller.id, cursor });
      for (const it of page.items) {
        expect(seen.has(it.id)).toBe(false);
        seen.add(it.id);
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen.size).toBe(120);
  });

  it("cursor inválido é ignorado em vez de dar erro", async () => {
    const { ctx } = await setupOrg();
    await expect(listTeamActivity(ctx.admin, { periodo: "today", cursor: "xyz|------------------------------------" })).resolves.toBeTruthy();
    await expect(listTeamActivity(ctx.admin, { periodo: "today", cursor: "2026-13-99T99:99:99Z|00000000-0000-0000-0000-000000000000" })).resolves.toBeTruthy();
  });

  it("só administrador vê", async () => {
    const { ctx } = await setupOrg();
    await expect(listTeamActivity(ctx.manager, { periodo: "7d" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(teamActivitySummary(ctx.seller, { periodo: "7d" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("não mostra eventos de outra organização", async () => {
    const a = await setupOrg("A");
    const b = await setupOrg("B");
    await createContact(b.ctx.seller, { name: "De outra org" });
    const r = await listTeamActivity(a.ctx.admin, { periodo: "today" });
    expect(r.items.some((i) => i.contactName === "De outra org")).toBe(false);
  });
});

describe("rótulos", () => {
  it("categoria e aparelho", () => {
    expect(activityCategory("instagram.lead_created")).toBe("leads");
    expect(activityCategory("instagram.dm_sent")).toBe("instagram");
    expect(activityCategory("member.invited")).toBe("settings");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Windows · Chrome");
    expect(deviceLabel(null)).toBeNull();
  });
});
