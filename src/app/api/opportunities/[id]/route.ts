import { authed, json, parseBody } from "@/server/http";
import { updateOpportunity, updateOpportunitySchema } from "@/server/services/commercial";

export const PATCH = authed(async (req, ctx, p) => json(await updateOpportunity(ctx, p.id, await parseBody(req, updateOpportunitySchema))));
