import { authed, json, parseBody, parseQuery } from "@/server/http";
import { createOpportunity, listOpportunities, listOpportunitiesSchema, opportunityInputSchema } from "@/server/services/commercial";

export const GET = authed(async (req, ctx) => json(await listOpportunities(ctx, parseQuery(req, listOpportunitiesSchema))));
export const POST = authed(async (req, ctx) => json(await createOpportunity(ctx, await parseBody(req, opportunityInputSchema)), 201));
