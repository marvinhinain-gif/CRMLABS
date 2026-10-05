import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphInstagramApi } from "@/server/integrations/instagram/client";

const calls: { url: URL; init: RequestInit }[] = [];
function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", async (url: URL | string, init: RequestInit) => {
    calls.push({ url: new URL(String(url)), init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
}
afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe("cliente da API do Instagram", () => {
  it("token de longa duração envia access_token como parâmetro (exigência da Meta)", async () => {
    mockFetch({ access_token: "LONG", expires_in: 5184000 });
    const r = await new GraphInstagramApi().longLivedToken("SHORT");
    expect(r).toMatchObject({ accessToken: "LONG", expiresIn: 5184000 });
    const { url, init } = calls[0];
    expect(url.origin + url.pathname).toBe("https://graph.instagram.com/access_token");
    expect(url.searchParams.get("grant_type")).toBe("ig_exchange_token");
    expect(url.searchParams.get("access_token")).toBe("SHORT");
    expect(url.searchParams.get("client_secret")).toBe(process.env.INSTAGRAM_APP_SECRET);
    expect(new Headers(init.headers).get("authorization")).toBeNull();
    expect("token" in init).toBe(false);
  });

  it("renovação, /me e inscrição de webhooks também levam o token", async () => {
    mockFetch({ access_token: "NEW", expires_in: 100, id: "1", user_id: "178", username: "olucaoferraz", success: true });
    const api = new GraphInstagramApi();
    await api.refreshToken("T1");
    await api.getMe("T2");
    await api.subscribeWebhooks("T3", ["messages", "comments"]);
    expect(calls.map((c) => c.url.searchParams.get("access_token"))).toEqual(["T1", "T2", "T3"]);
    expect(calls[2].url.searchParams.get("subscribed_fields")).toBe("messages,comments");
    expect(calls[2].init.method).toBe("POST");
  });

  it("erro da Meta vira ProviderError com a mensagem original", async () => {
    mockFetch({ error: { message: "The parameter access_token is required.", type: "OAuthException", code: 100 } }, 400);
    await expect(new GraphInstagramApi().longLivedToken("X")).rejects.toMatchObject({ message: "The parameter access_token is required.", code: 100 });
  });
});
