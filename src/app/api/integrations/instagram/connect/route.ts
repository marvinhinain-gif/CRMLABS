import { authed, json } from "@/server/http";
import { startConnect } from "@/server/integrations/instagram/oauth";

export const POST = authed(async (_req, ctx) => json({ url: await startConnect(ctx) }));
