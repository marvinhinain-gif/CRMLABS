import { describe, expect, it } from "vitest";
import { acceptInvite, getInvite, login, requestPasswordReset, resetPassword, resolveSession, revokeSession } from "@/server/auth/service";
import { consoleOutbox } from "@/server/mail";
import { createOrganization } from "@/server/services/common";
import { inviteMember, updateMember } from "@/server/services/team";
import { ctxFor, makeUser } from "./helpers";

const PW = "senha-forte-123";

async function base() {
  const org = await createOrganization({ name: "AXION" });
  const admin = await makeUser(org.id, "admin", { password: PW });
  return { org, admin };
}

describe("autenticação", () => {
  it("autentica com credenciais corretas e cria sessão no servidor", async () => {
    const { admin } = await base();
    const r = await login({ email: admin.email.toUpperCase(), password: PW, remember: false });
    const ctx = await resolveSession(r.token);
    expect(ctx?.userId).toBe(admin.id);
    expect(ctx?.role).toBe("admin");
  });

  it("usa mensagem genérica para e-mail inexistente e senha errada", async () => {
    const { admin } = await base();
    await expect(login({ email: "naoexiste@x.com", password: PW, remember: false })).rejects.toThrow("E-mail ou senha incorretos.");
    await expect(login({ email: admin.email, password: "errada-errada", remember: false })).rejects.toThrow("E-mail ou senha incorretos.");
  });

  it("bloqueia após tentativas abusivas", async () => {
    const { admin } = await base();
    for (let i = 0; i < 5; i++) await login({ email: admin.email, password: "x".repeat(12), remember: false }).catch(() => {});
    await expect(login({ email: admin.email, password: PW, remember: false })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("lembrar de mim só altera a duração da sessão", async () => {
    const { admin } = await base();
    const short = await login({ email: admin.email, password: PW, remember: false });
    const long = await login({ email: admin.email, password: PW, remember: true });
    expect(long.expiresAt.getTime() - short.expiresAt.getTime()).toBeGreaterThan(20 * 24 * 3600 * 1000);
  });

  it("logout revoga a sessão", async () => {
    const { admin } = await base();
    const r = await login({ email: admin.email, password: PW, remember: false });
    await revokeSession(r.token);
    expect(await resolveSession(r.token)).toBeNull();
  });

  it("usuário desativado perde o acesso imediatamente", async () => {
    const { org, admin } = await base();
    const seller = await makeUser(org.id, "seller", { password: PW });
    const s = await login({ email: seller.email, password: PW, remember: false });
    const adminCtx = await ctxFor(admin.id, org.id);
    await updateMember(adminCtx, seller.id, { status: "disabled" });
    expect(await resolveSession(s.token)).toBeNull();
    await expect(login({ email: seller.email, password: PW, remember: false })).rejects.toThrow("E-mail ou senha incorretos.");
  });

  it("recuperação: link de uso único, resposta neutra e senhas antigas invalidadas", async () => {
    const { admin } = await base();
    consoleOutbox.length = 0;
    await requestPasswordReset("ninguem@x.com");
    expect(consoleOutbox).toHaveLength(0); // não revela inexistência, apenas não envia
    await requestPasswordReset(admin.email);
    const token = /token=([^\s]+)/.exec(consoleOutbox.at(-1)!.text)![1];
    const sessionBefore = await login({ email: admin.email, password: PW, remember: false });
    await resetPassword(decodeURIComponent(token), "nova-senha-segura");
    await expect(resetPassword(decodeURIComponent(token), "outra-senha-segura")).rejects.toThrow(/inválido|expirou|usado/);
    expect(await resolveSession(sessionBefore.token)).toBeNull();
    await expect(login({ email: admin.email, password: "nova-senha-segura", remember: false })).resolves.toBeTruthy();
  });

  it("convite: somente administrador convida; aceite define senha e ativa acesso", async () => {
    const { org, admin } = await base();
    const adminCtx = await ctxFor(admin.id, org.id);
    const seller = await makeUser(org.id, "seller");
    const sellerCtx = await ctxFor(seller.id, org.id);
    await expect(inviteMember(sellerCtx, { name: "X", email: "x@x.com", role: "seller" })).rejects.toMatchObject({ code: "forbidden" });

    consoleOutbox.length = 0;
    await inviteMember(adminCtx, { name: "Nova Pessoa", email: "nova@axion.com", role: "closer" });
    const token = decodeURIComponent(/token=([^\s]+)/.exec(consoleOutbox.at(-1)!.text)![1]);
    expect((await getInvite(token))?.email).toBe("nova@axion.com");
    await expect(login({ email: "nova@axion.com", password: PW, remember: false })).rejects.toThrow();
    const session = await acceptInvite(token, "senha-do-convite-1");
    expect((await resolveSession(session.token))?.role).toBe("closer");
    await expect(acceptInvite(token, "senha-do-convite-1")).rejects.toThrow();
  });
});
