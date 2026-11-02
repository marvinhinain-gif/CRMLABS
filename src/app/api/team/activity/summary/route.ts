import { authed, json, parseQuery } from "@/server/http";
import { activitySummarySchema, teamActivitySummary } from "@/server/services/activity";

export const GET = authed(async (req, ctx) => json(await teamActivitySummary(ctx, parseQuery(req, activitySummarySchema))));
