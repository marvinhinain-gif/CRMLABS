import { authed, json } from "@/server/http";
import { regenerateToken } from "@/server/services/integrations";

export const POST = authed(async (_req, ctx, p) => json(await regenerateToken(ctx, p.id)));
