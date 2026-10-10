import { authed, json, parseQuery } from "@/server/http";
import { formAnalytics, responseFilterSchema } from "@/server/services/quizReports";

export const GET = authed(async (req, ctx, p) => json(await formAnalytics(ctx, p.id, parseQuery(req, responseFilterSchema))));
