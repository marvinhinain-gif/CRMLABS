import { authed, json } from "@/server/http";
import { formHistory } from "@/server/services/quizzes";

export const GET = authed(async (_req, ctx, p) => json(await formHistory(ctx, p.id)));
