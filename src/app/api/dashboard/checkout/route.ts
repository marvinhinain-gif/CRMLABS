import { authed, json, parseQuery } from "@/server/http";
import { commercialDashboardSchema } from "@/server/services/metrics";
import { checkoutDashboard } from "@/server/services/checkout";

export const GET = authed(async (req, ctx) => json(await checkoutDashboard(ctx, parseQuery(req, commercialDashboardSchema))));
