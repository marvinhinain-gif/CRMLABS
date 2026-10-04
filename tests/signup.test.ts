import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { memberships, notifications, organizations, users } from "@/server/db/schema";
import { login } from "@/server/auth/service";
import { approveSignup, rejectSignup, requestSignup } from "@/server/auth/signup";
import { listMembers } from "@/server/services/team";
import { createOrganization } from "@/server/services/common";
import { consoleOutbox } from "@/server/mail";
import { setupOrg } from "./helpers";

const PW = "senha-do-cadastro-1";

describe("cadastro com aprovação", () => {
  it("pedido fica pendente: não entra até o administrador aprovar", async () => {
    const { ctx, users: u } = await setupOrg();
    const r = await requestSignup({ name: "Joana Prado", email: "Joana@Exemplo.com", password: PW, note: "Sou closer" });
    expect(r.message).toMatch(/aprovar/);
    await expect(login({ email: "joana@exemplo.com", password: PW, remember: false })).rejects.toMatchObject({ code: "forbidden", message: expect.stringMatching(/aguardando/) });
    // senha errada continua com a mensagem genérica (não revela o pedido)
    await expect(login({ email: "joana@exemplo.com", password: "outra-senha-qualquer", remember: false })).rejects.toThrow("E-mail ou senha incorretos.");
    // administrador é notificado e vê o pedido; seller não vê
    const notif = await db.select().from(notifications).where(eq(notifications.userId, u.admin.id));
    expect(notif.some((n) => n.type === "member.requested")).toBe(true);
    expect((await listMembers(ctx.admin)).find((m) => m.email === "joana@exemplo.com")).toMatchObject({ status: "pending", requestNote: "Sou closer" });
    expect((await listMembers(ctx.seller)).some((m) => m.name === "Joana Prado")).toBe(false);

    const joana = (await db.select().from(users)).find((x) => x.email === "joana@exemplo.com")!;
    await expect(approveSignup(ctx.manager, joana.id, { role: "closer" })).rejects.toMatchObject({ code: "forbidden" });
    consoleOutbox.length = 0;
    await approveSignup(ctx.admin, joana.id, { role: "closer" });
    expect(consoleOutbox.at(-1)?.subject).toMatch(/aprovado/);
    const s = await login({ email: "joana@exemplo.com", password: PW, remember: false });
    expect(s.token).toBeTruthy();
    const [m] = await db.select().from(memberships).where(eq(memberships.userId, joana.id));
    expect(m).toMatchObject({ role: "closer", status: "active" });
  });

  it("recusar remove o pedido e a conta criada no cadastro", async () => {
    const { ctx } = await setupOrg();
    await requestSignup({ name: "Spam", email: "spam@x.com", password: PW });
    const u = (await db.select().from(users)).find((x) => x.email === "spam@x.com")!;
    await rejectSignup(ctx.admin, u.id);
    expect((await db.select().from(users)).some((x) => x.email === "spam@x.com")).toBe(false);
    await expect(login({ email: "spam@x.com", password: PW, remember: false })).rejects.toThrow("E-mail ou senha incorretos.");
  });

  it("e-mail já cadastrado recebe a mesma resposta e não tem a senha trocada", async () => {
    const { users: u } = await setupOrg();
    const before = (await db.select().from(users).where(eq(users.id, u.seller.id)))[0].passwordHash;
    consoleOutbox.length = 0;
    const r = await requestSignup({ name: "Invasor", email: u.seller.email, password: PW });
    expect(r.message).toMatch(/aprovar/);
    const after = (await db.select().from(users).where(eq(users.id, u.seller.id)))[0];
    expect(after.passwordHash).toBe(before);
    expect(after.name).not.toBe("Invasor");
    expect(consoleOutbox.at(-1)?.to).toBe(u.seller.email);
  });

  it("cadastro fechado ou só organização demo: recusa o pedido", async () => {
    const { org } = await setupOrg();
    await db.update(organizations).set({ allowSignup: false }).where(eq(organizations.id, org.id));
    await createOrganization({ name: "Demo", isDemo: true });
    await expect(requestSignup({ name: "X Y", email: "x@y.com", password: PW })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("limita pedidos repetidos do mesmo dispositivo", async () => {
    await setupOrg();
    for (let i = 0; i < 5; i++) await requestSignup({ name: `P ${i}`, email: `p${i}@x.com`, password: PW }, "1.2.3.4");
    await expect(requestSignup({ name: "P 6", email: "p6@x.com", password: PW }, "1.2.3.4")).rejects.toMatchObject({ code: "rate_limited" });
  });
});
