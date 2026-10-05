import { db } from "@/server/db";
import { memberships, users, organizations } from "@/server/db/schema";
import { createOrganization } from "@/server/services/common";
import { createSession, resolveSession } from "@/server/auth/service";
import { hashPassword } from "@/server/crypto";
import type { Ctx } from "@/server/context";
import type { Role } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import type { InstagramApi } from "@/server/integrations/instagram/client";
import { ProviderError } from "@/server/integrations/instagram/client";

let seq = 0;

export async function makeUser(orgId: string, role: Role, opts: { password?: string; name?: string; status?: "active" | "invited" | "disabled" } = {}) {
  seq++;
  const [u] = await db
    .insert(users)
    .values({ email: `user${seq}@teste.local`, name: opts.name ?? `${role} ${seq}`, passwordHash: opts.password ? await hashPassword(opts.password) : null })
    .returning();
  await db.insert(memberships).values({ orgId, userId: u.id, role, status: opts.status ?? "active" });
  return u;
}

export async function ctxFor(userId: string, orgId: string): Promise<Ctx> {
  const s = await createSession(userId, orgId, false);
  const ctx = await resolveSession(s.token);
  if (!ctx) throw new Error("Sessão de teste inválida");
  return ctx;
}

export async function setupOrg(name = "Org Teste") {
  const org = await createOrganization({ name });
  const admin = await makeUser(org.id, "admin", { name: "Admin" });
  const manager = await makeUser(org.id, "manager", { name: "Gestora" });
  const seller = await makeUser(org.id, "seller", { name: "Mariana" });
  const seller2 = await makeUser(org.id, "seller", { name: "Rafael" });
  const closer = await makeUser(org.id, "closer", { name: "Carla" });
  return {
    org,
    users: { admin, manager, seller, seller2, closer },
    ctx: {
      admin: await ctxFor(admin.id, org.id),
      manager: await ctxFor(manager.id, org.id),
      seller: await ctxFor(seller.id, org.id),
      seller2: await ctxFor(seller2.id, org.id),
      closer: await ctxFor(closer.id, org.id),
    },
  };
}

export async function refreshCtx(ctx: Ctx) {
  const [o] = await db.select().from(organizations).where(eq(organizations.id, ctx.orgId));
  return { ...ctx, org: { ...ctx.org, sharedInbox: o.sharedInbox, autoEntryStageId: o.autoEntryStageId } };
}

/** Adaptador falso para testes de contrato. Registra chamadas; nunca usado fora dos testes. */
export class FakeInstagramApi implements InstagramApi {
  calls: { method: string; args: unknown[] }[] = [];
  sendBehavior: "ok" | "timeout" | "window" | "auth" = "ok";
  meUserId = "17841400000000001";
  grantedPermissions = ["instagram_business_basic", "instagram_business_manage_messages", "instagram_business_manage_comments"];
  providerMessages: { id: string; text?: string; createdTime: string; fromId?: string }[] = [];
  private n = 0;
  private record(method: string, ...args: unknown[]) {
    this.calls.push({ method, args });
  }
  count(method: string) {
    return this.calls.filter((c) => c.method === method).length;
  }
  async exchangeCode(code: string) {
    this.record("exchangeCode", code);
    return { accessToken: "short-token", userId: this.meUserId, permissions: this.grantedPermissions };
  }
  async longLivedToken(t: string) {
    this.record("longLivedToken", t);
    return { accessToken: "long-token-secret", expiresIn: 5184000, permissions: [] };
  }
  async refreshToken(t: string) {
    this.record("refreshToken", t);
    return { accessToken: "long-token-2", expiresIn: 5184000, permissions: [] };
  }
  async getMe(t: string) {
    this.record("getMe", t);
    return { id: "app-scoped-1", userId: this.meUserId, username: "olucaoferraz", accountType: "BUSINESS" };
  }
  async subscribeWebhooks(t: string, f: string[]) {
    this.record("subscribeWebhooks", t, f);
  }
  async unsubscribeWebhooks(t: string) {
    this.record("unsubscribeWebhooks", t);
  }
  private outcome() {
    if (this.sendBehavior === "timeout") throw new ProviderError("timeout", "timeout");
    if (this.sendBehavior === "window") throw new ProviderError("window", "Outside of allowed window", 10, 2534022);
    if (this.sendBehavior === "auth") throw new ProviderError("auth", "Invalid OAuth access token", 190);
  }
  async sendText(t: string, r: string, text: string, o?: { humanAgent?: boolean }) {
    this.record("sendText", t, r, text, o);
    this.outcome();
    return { messageId: `mid.out.${++this.n}`, recipientId: r };
  }
  async sendPrivateReply(t: string, c: string, text: string) {
    this.record("sendPrivateReply", t, c, text);
    this.outcome();
    return { messageId: `mid.pr.${++this.n}` };
  }
  async replyToComment(t: string, c: string, text: string) {
    this.record("replyToComment", t, c, text);
    this.outcome();
    return { id: `reply.${++this.n}` };
  }
  async getUserProfile(t: string, id: string) {
    this.record("getUserProfile", t, id);
    return { name: "Ana Souza", username: "anasouza" };
  }
  async findConversationMessages(t: string, id: string) {
    this.record("findConversationMessages", t, id);
    return this.providerMessages;
  }
  async listMedia() {
    return [];
  }
  async listComments() {
    return [];
  }
  conversations: import("@/server/integrations/instagram/client").ConversationItem[] = [];
  media: import("@/server/integrations/instagram/client").MediaDetails[] = [];
  async listConversations() {
    this.record("listConversations");
    return this.conversations;
  }
  async listMediaWithComments() {
    this.record("listMediaWithComments");
    return this.media;
  }
  async getMedia(_t: string, id: string) {
    this.record("getMedia", id);
    return this.media.find((m) => m.id === id) ?? { id };
  }
  async commentOnMedia(t: string, mediaId: string, text: string) {
    this.record("commentOnMedia", t, mediaId, text);
    this.outcome();
    return { id: `own.${++this.n}` };
  }
  async hideComment(t: string, id: string, hide: boolean) {
    this.record("hideComment", t, id, hide);
    this.outcome();
  }
  async deleteComment(t: string, id: string) {
    this.record("deleteComment", t, id);
    this.outcome();
  }
}
