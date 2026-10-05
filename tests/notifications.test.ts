import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

const sent: { endpoint: string; body: string }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => ({
  default: {
    generateVAPIDKeys: () => ({ publicKey: "BPub" + "x".repeat(83), privateKey: "priv-" + "y".repeat(38) }),
    sendNotification: async (sub: { endpoint: string }, body: string) => {
      if (failWith) throw Object.assign(new Error("push failed"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, body });
      return { statusCode: 201 };
    },
  },
}));

import { db } from "@/server/db";
import { instanceSettings, notifications, pushSubscriptions } from "@/server/db/schema";
import { createContact } from "@/server/services/contacts";
import { getBoard, moveEntry } from "@/server/services/board";
import { listStages } from "@/server/services/stages";
import { createAppointment, createOpportunity, decideOpportunity } from "@/server/services/commercial";
import { dispatchPendingPush, isAllowedEndpoint, setPrefs, subscribe } from "@/server/services/push";
import { instagramConfig } from "@/server/env";
import { instagramSetupState, loadInstanceSettings, saveInstagramCredentials } from "@/server/services/instance";
import { createOrganization } from "@/server/services/common";
import { ctxFor, makeUser, setupOrg } from "./helpers";

const FCM = "https://fcm.googleapis.com/fcm/send/abc";
const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
const notesOf = (userId: string) => db.select().from(notifications).where(eq(notifications.userId, userId));

beforeEach(() => {
  sent.length = 0;
  failWith = null;
});

describe("alertas para o administrador", () => {
  it("lead mudou de etapa: administrador recebe, quem moveu não", async () => {
    const { ctx, users: u } = await setupOrg();
    const [s1, s2] = await listStages(ctx.admin, "relationship");
    await createContact(ctx.seller, { name: "Ana Souza", stageId: s1.id });
    const card = (await getBoard(ctx.seller, {})).stages[0].cards[0];
    await moveEntry(ctx.seller, card.entryId, { toStageId: s2.id, expectedVersion: card.version });
    const [n] = (await notesOf(u.admin.id)).filter((x) => x.type === "lead.stage_changed");
    expect(n.title).toBe(`Ana Souza → ${s2.name}`);
    expect(n.body).toContain(s1.name);
    expect(n.body).toContain("Mariana");
    expect(n.link).toContain("contato=");
    expect((await notesOf(u.seller.id)).some((x) => x.type === "lead.stage_changed")).toBe(false);
    expect((await notesOf(u.manager.id)).some((x) => x.type === "lead.stage_changed")).toBe(false);

    // Quando o próprio administrador move, ele não é avisado de si mesmo.
    const card2 = (await getBoard(ctx.admin, {})).stages.find((s) => s.id === s2.id)!.cards[0];
    await moveEntry(ctx.admin, card2.entryId, { toStageId: s1.id, expectedVersion: card2.version });
    expect((await notesOf(u.admin.id)).filter((x) => x.type === "lead.stage_changed")).toHaveLength(1);
  });

  it("reunião agendada avisa o administrador", async () => {
    const { ctx, users: u } = await setupOrg();
    const c = await createContact(ctx.seller, { name: "Pedro Lima" });
    await createAppointment(ctx.seller, { contactId: c.id, title: "Apresentação", startsAt: new Date("2026-10-10T17:00:00Z"), endsAt: new Date("2026-10-10T18:00:00Z"), timezone: "America/Bahia" });
    const [n] = (await notesOf(u.admin.id)).filter((x) => x.type === "meeting.scheduled");
    expect(n.title).toBe("Reunião agendada com Pedro Lima");
    expect(n.body).toContain("10/10/2026, 14:00");
    expect(n.body).toContain("Mariana");
  });

  it("venda fechada traz valor, vendedor e social seller; vai para admin e envolvidos", async () => {
    const { ctx, users: u } = await setupOrg();
    const c = await createContact(ctx.seller, { name: "Lucas Oliveira" });
    const opp = await createOpportunity(ctx.manager, { contactId: c.id, title: "Mentoria", valueCents: 480000, closerId: u.closer.id });
    await decideOpportunity(ctx.closer, opp.id, { status: "won" });
    const [n] = (await notesOf(u.admin.id)).filter((x) => x.type === "sale.won");
    expect(n.title).toMatch(/R\$\s4\.800,00/);
    expect(n.body).toContain("Lucas Oliveira");
    expect(n.body).toContain("Vendedor: Carla");
    expect(n.body).toContain("Social seller: Mariana");
    expect((await notesOf(u.seller.id)).some((x) => x.type === "sale.won")).toBe(true);
    expect((await notesOf(u.closer.id)).some((x) => x.type === "sale.won")).toBe(false); // quem registrou
    expect((await notesOf(u.seller2.id)).some((x) => x.type === "sale.won")).toBe(false);
  });
});

describe("notificações no celular", () => {
  it("entrega uma única vez, respeita preferências e limpa aparelho removido", async () => {
    const { ctx, users: u } = await setupOrg();
    await subscribe(ctx.admin, { endpoint: FCM, keys }, "teste");
    const c = await createContact(ctx.seller, { name: "Lucas" });
    const opp = await createOpportunity(ctx.manager, { contactId: c.id, title: "Mentoria", valueCents: 100000, closerId: u.closer.id });
    await decideOpportunity(ctx.closer, opp.id, { status: "won" });

    expect(await dispatchPendingPush()).toBe(1);
    expect(sent).toHaveLength(1);
    const payload = JSON.parse(sent[0].body);
    expect(payload.title).toMatch(/R\$\s1\.000,00/);
    expect(payload.url).toBe("/comercial?aba=ganhas");
    expect(await dispatchPendingPush()).toBe(0); // não repete

    await setPrefs(ctx.admin, { meeting: false });
    await createAppointment(ctx.seller, { contactId: c.id, title: "Call", startsAt: new Date("2026-10-11T12:00:00Z"), endsAt: new Date("2026-10-11T13:00:00Z"), timezone: "America/Bahia" });
    expect(await dispatchPendingPush()).toBe(0);
    expect(sent).toHaveLength(1);

    failWith = 410;
    const [s1, s2] = await listStages(ctx.admin, "relationship");
    await createContact(ctx.seller, { name: "Bia", stageId: s1.id });
    const card = (await getBoard(ctx.seller, {})).stages[0].cards[0];
    await moveEntry(ctx.seller, card.entryId, { toStageId: s2.id, expectedVersion: card.version });
    await dispatchPendingPush();
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it("só aceita endereços de serviços de push conhecidos (sem SSRF)", async () => {
    const { ctx } = await setupOrg();
    expect(isAllowedEndpoint("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(isAllowedEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.com/x", "https://localhost:3000/x", "https://evilpush.apple.com.attacker.io/"]) {
      expect(isAllowedEndpoint(bad)).toBe(false);
    }
    await expect(subscribe(ctx.admin, { endpoint: "https://127.0.0.1/x", keys }, null)).rejects.toMatchObject({ code: "invalid" });
  });

  it("aparelho que troca de conta passa a receber só para a conta atual", async () => {
    const { ctx, users: u } = await setupOrg();
    await subscribe(ctx.admin, { endpoint: FCM, keys }, null);
    await subscribe(ctx.seller, { endpoint: FCM, keys }, null);
    const rows = await db.select().from(pushSubscriptions);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(u.seller.id);
  });
});

describe("credenciais do Instagram pelo painel", () => {
  it("administrador da organização principal salva; segredo fica criptografado e nunca volta", async () => {
    const saved = { id: process.env.INSTAGRAM_APP_ID, secret: process.env.INSTAGRAM_APP_SECRET, verify: process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN };
    delete process.env.INSTAGRAM_APP_ID;
    delete process.env.INSTAGRAM_APP_SECRET;
    delete process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
    try {
      const { ctx } = await setupOrg();
      await loadInstanceSettings(true);
      expect(instagramConfig().missing).toContain("INSTAGRAM_APP_ID");
      const secret = "0123456789abcdef0123456789abcdef";
      await expect(saveInstagramCredentials(ctx.manager, { appId: "1234567890", appSecret: secret })).rejects.toMatchObject({ code: "forbidden" });
      const st = await saveInstagramCredentials(ctx.admin, { appId: "1234567890", appSecret: secret });
      expect(st).toMatchObject({ appId: "1234567890", appSecretSet: true, appIdSource: "panel" });
      expect(JSON.stringify(st)).not.toContain(secret);
      expect(st.verifyToken.length).toBeGreaterThan(20);
      const [row] = await db.select().from(instanceSettings).where(eq(instanceSettings.key, "instagram.app_secret"));
      expect(row.value).not.toContain(secret);
      expect(instagramConfig()).toMatchObject({ appId: "1234567890", appSecret: secret, missing: [] });

      // Em branco mantém a chave já salva.
      await saveInstagramCredentials(ctx.admin, { appId: "1234567891", appSecret: "" });
      expect(instagramConfig().appSecret).toBe(secret);

      // Administrador de outra organização (mais nova) não altera a configuração da instalação.
      const other = await createOrganization({ name: "Outra" });
      const otherAdmin = await makeUser(other.id, "admin");
      const octx = await ctxFor(otherAdmin.id, other.id);
      await expect(saveInstagramCredentials(octx, { appId: "1", appSecret: "" })).rejects.toBeTruthy();
      expect((await instagramSetupState(octx)).canEdit).toBe(false);
      expect((await instagramSetupState(octx)).verifyToken).toBe("");
    } finally {
      process.env.INSTAGRAM_APP_ID = saved.id;
      process.env.INSTAGRAM_APP_SECRET = saved.secret;
      process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN = saved.verify;
      await loadInstanceSettings(true);
    }
  });
});
