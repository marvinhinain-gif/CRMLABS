import { authed, json, parseQuery } from "@/server/http";
import { dashboardSchema, formsDashboard } from "@/server/services/quizzes";

export const GET = authed(async (req, ctx) => json(await formsDashboard(ctx, parseQuery(req, dashboardSchema))));
