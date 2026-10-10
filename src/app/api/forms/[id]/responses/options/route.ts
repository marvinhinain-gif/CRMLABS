import { authed, json } from "@/server/http";
import { responseFilterOptions } from "@/server/services/quizReports";

export const GET = authed(async (_req, ctx, p) => json(await responseFilterOptions(ctx, p.id)));
