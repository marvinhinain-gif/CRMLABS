import { authed, json, parseBody } from "@/server/http";
import { decideOpportunity, decideSchema } from "@/server/services/commercial";

export const POST = authed(async (req, ctx, p) => json(await decideOpportunity(ctx, p.id, await parseBody(req, decideSchema))));
