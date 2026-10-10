import { authed, json } from "@/server/http";
import { anonymizeContactSubmissions } from "@/server/services/quizReports";

export const POST = authed(async (_req, ctx, p) => json(await anonymizeContactSubmissions(ctx, p.id)));
