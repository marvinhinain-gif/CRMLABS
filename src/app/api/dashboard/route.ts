import { authed, json, parseQuery } from "@/server/http";
import { dashboardSchema, getDashboard } from "@/server/services/dashboard";

export const GET = authed(async (req, ctx) => json(await getDashboard(ctx, parseQuery(req, dashboardSchema))));
