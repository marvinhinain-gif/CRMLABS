import { eq } from "drizzle-orm";
import { authed, json } from "@/server/http";
import { db } from "@/server/db";
import { connectedAccounts } from "@/server/db/schema";
import { publicAccount } from "@/server/integrations/instagram/oauth";
import { mailStatus } from "@/server/mail";
import { can } from "@/server/permissions";
import { instagramConfigFresh } from "@/server/services/instance";

export const GET = authed(async (_req, ctx) => {
  const accounts = await db.select().from(connectedAccounts).where(eq(connectedAccounts.orgId, ctx.orgId));
  const cfg = await instagramConfigFresh();
  const isAdmin = can(ctx, "integrations.manage");
  return json({
    accounts: accounts.map(publicAccount),
    instagram: isAdmin
      ? { configured: cfg.missing.length === 0, missing: cfg.missing, httpsPublic: cfg.httpsPublic, redirectUri: cfg.redirectUri, webhookUrl: cfg.webhookUrl, graphVersion: cfg.graphVersion, humanAgentEnabled: cfg.humanAgentEnabled }
      : null,
    mail: isAdmin ? mailStatus() : null,
  });
});
