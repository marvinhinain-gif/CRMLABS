import { authed, json } from "@/server/http";
import { getSubmission } from "@/server/services/quizReports";

export const GET = authed(async (_req, ctx, p) => json(await getSubmission(ctx, p.sid)));
