import { authed, json } from "@/server/http";
import { duplicateForm } from "@/server/services/quizzes";

export const POST = authed(async (_req, ctx, p) => json(await duplicateForm(ctx, p.id), 201));
