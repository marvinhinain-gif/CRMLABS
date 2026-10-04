import { describe, expect, it, afterEach } from "vitest";
import { login, resolveSession, createSession, changePassword } from "@/server/auth/service";
import { createAccessLink, inviteMember } from "@/server/services/team";
import { resetPassword } from "@/server/auth/service";
import { setupOrg, makeUser, ctxFor } from "./helpers";

const PW = "senha-forte-123";
const APP_URL = process.env.APP_URL;
afterEach(() => {
  process.env.MAIL_TRANSPORT = "console";
  process.env.APP_URL = APP_URL;
  delete process.env.RENDER_EXTERNAL_URL;
});

describe("produção sem e-mail", () => {
  it("convite devolve o link ao administrador quando não há e-mail", async () => {
    const { ctx } = await setupOrg();
    process.env.MAIL_TRANSPORT = "none";
    process.env.APP_URL = "";
    process.env.RENDER_EXTERNAL_URL = "https://crmlabs.onrender.com";
    const r = await inviteMember(ctx.admin, { name: "Nova", email: "nova@x.com", role: "seller" });
    expect(r.emailed).toBe(false);
    expect("link" in r && r.link).toMatch(/^https:\/\/crmlabs\.onrender\.com\/convite\?token=/);
  });

  it("administrador gera link de nova senha de uso único", async () => {
    const { ctx, users } = await setupOrg();
    const r = await createAccessLink(ctx.admin, users.seller.id);
    const token = decodeURIComponent(new URL(r.link).searchParams.get("token")!);
    await resetPassword(token, "senha-nova-do-seller");
    await expect(login({ email: users.seller.email, password: "senha-nova-do-seller", remember: false })).resolves.toBeTruthy();
    await expect(resetPassword(token, "outra-senha-qualquer")).rejects.toThrow();
    await expect(createAccessLink(ctx.manager, users.seller.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("troca de senha exige a atual e encerra as outras sessões", async () => {
    const { org } = await setupOrg();
    const u = await makeUser(org.id, "seller", { password: PW });
    const ctx = await ctxFor(u.id, org.id);
    const other = await createSession(u.id, org.id, false);
    await expect(changePassword(ctx, "errada-errada", "senha-nova-123")).rejects.toMatchObject({ code: "invalid" });
    await changePassword(ctx, PW, "senha-nova-123");
    expect(await resolveSession(other.token)).toBeNull();
    expect(await resolveSession(null)).toBeNull();
    await expect(login({ email: u.email, password: "senha-nova-123", remember: false })).resolves.toBeTruthy();
  });
});
