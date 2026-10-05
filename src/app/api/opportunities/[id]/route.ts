import { authed, json, parseBody } from "@/server/http";
import { getOpportunityDetail, updateOpportunity, updateOpportunitySchema } from "@/server/services/commercial";

export const GET = authed(async (_req, ctx, p) => json(await getOpportunityDetail(ctx, p.id)));
export const PATCH = authed(async (req, ctx, p) => json(await updateOpportunity(ctx, p.id, await parseBody(req, updateOpportunitySchema))));
