import { authed, json, parseBody } from "@/server/http";
import { overrideRecommendation, overrideSchema } from "@/server/services/quizReports";

/** Ajuste manual do produto sugerido (a sugestão original continua guardada). */
export const POST = authed(async (req, ctx, p) => json(await overrideRecommendation(ctx, p.sid, await parseBody(req, overrideSchema))));
