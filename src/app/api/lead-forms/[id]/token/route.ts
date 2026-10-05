import { authed, json } from "@/server/http";
import { regenerateFormToken } from "@/server/services/leads";

export const POST = authed(async (_req, ctx, p) => json(await regenerateFormToken(ctx, p.id)));
