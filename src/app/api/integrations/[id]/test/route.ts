import { authed, json } from "@/server/http";
import { publicAccount, testConnection } from "@/server/integrations/instagram/oauth";

export const POST = authed(async (_req, ctx, p) => json(publicAccount(await testConnection(ctx, p.id))));
