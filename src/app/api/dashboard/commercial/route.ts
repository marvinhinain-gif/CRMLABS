import { authed, json, parseQuery } from "@/server/http";
import { commercialDashboardSchema, getCommercialDashboard } from "@/server/services/metrics";

export const GET = authed(async (req, ctx) => json(await getCommercialDashboard(ctx, parseQuery(req, commercialDashboardSchema))));
