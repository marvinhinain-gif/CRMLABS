import { authed, json } from "@/server/http";
import { dashboardOptions } from "@/server/services/metrics";

export const GET = authed(async (_req, ctx) => json(await dashboardOptions(ctx)));
