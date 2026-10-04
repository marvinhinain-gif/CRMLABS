import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { hmacSha256Hex } from "@/server/crypto";
import { createSession } from "@/server/auth/service";
import { setupOrg } from "./helpers";
import * as webhook from "@/app/api/webhooks/instagram/route";
import * as contactsRoute from "@/app/api/contacts/route";
import * as integrationsRoute from "@/app/api/integrations/route";

const BASE = "http://localhost:3000";
const rc = { params: Promise.resolve({}) };

describe("HTTP: webhooks, sessão, CSRF e segredos", () => {
  it("verificação do webhook responde ao hub.challenge só com o token correto", async () => {
    const ok = await webhook.GET(new NextRequest(`${BASE}/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=123`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("123");
    const bad = await webhook.GET(new NextRequest(`${BASE}/api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=123`));
    expect(bad.status).toBe(403);
  });

  it("POST de webhook sem assinatura válida é rejeitado", async () => {
    const body = JSON.stringify({ object: "instagram", entry: [] });
    const r = await webhook.POST(new NextRequest(`${BASE}/api/webhooks/instagram`, { method: "POST", body, headers: { "x-hub-signature-256": "sha256=000" } }));
    expect(r.status).toBe(401);
    const ok = await webhook.POST(new NextRequest(`${BASE}/api/webhooks/instagram`, { method: "POST", body, headers: { "x-hub-signature-256": `sha256=${hmacSha256Hex("test-app-secret", body)}` } }));
    expect(ok.status).toBe(200);
  });

  it("API exige sessão válida e bloqueia origem estrangeira em mutações", async () => {
    const { users, org } = await setupOrg();
    const noSession = await contactsRoute.GET(new NextRequest(`${BASE}/api/contacts`), rc);
    expect(noSession.status).toBe(401);
    const s = await createSession(users.seller.id, org.id, false);
    const cookie = `crmlabs_session=${s.token}`;
    const list = await contactsRoute.GET(new NextRequest(`${BASE}/api/contacts`, { headers: { cookie } }), rc);
    expect(list.status).toBe(200);
    const evil = await contactsRoute.POST(new NextRequest(`${BASE}/api/contacts`, { method: "POST", body: JSON.stringify({ name: "X" }), headers: { cookie, origin: "https://malicioso.example", "content-type": "application/json" } }), rc);
    expect(evil.status).toBe(403);
    const good = await contactsRoute.POST(new NextRequest(`${BASE}/api/contacts`, { method: "POST", body: JSON.stringify({ name: "Ana" }), headers: { cookie, origin: BASE, "content-type": "application/json" } }), rc);
    expect(good.status).toBe(201);
  });

  it("dados de integração não expõem tokens e só mostram configuração a administradores", async () => {
    const { users, org } = await setupOrg();
    const sAdmin = await createSession(users.admin.id, org.id, false);
    const sSeller = await createSession(users.seller.id, org.id, false);
    const a = await (await integrationsRoute.GET(new NextRequest(`${BASE}/api/integrations`, { headers: { cookie: `crmlabs_session=${sAdmin.token}` } }), rc)).json();
    const b = await (await integrationsRoute.GET(new NextRequest(`${BASE}/api/integrations`, { headers: { cookie: `crmlabs_session=${sSeller.token}` } }), rc)).json();
    expect(a.instagram.redirectUri).toMatch(/callback$/);
    expect(b.instagram).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/secret|access_?token/i);
  });
});
