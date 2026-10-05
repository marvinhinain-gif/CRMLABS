import { authed, json, parseQuery } from "@/server/http";
import { metricsSchema, originMetrics } from "@/server/services/integrations";

export const GET = authed(async (req, ctx) => json(await originMetrics(ctx, parseQuery(req, metricsSchema))));
