import { authed, json } from "@/server/http";
import { publishForm } from "@/server/services/quizzes";

export const POST = authed(async (_req, ctx, p) => json(await publishForm(ctx, p.id)));
