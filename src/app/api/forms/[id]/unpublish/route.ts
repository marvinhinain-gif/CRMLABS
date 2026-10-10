import { authed, json } from "@/server/http";
import { unpublishForm } from "@/server/services/quizzes";

export const POST = authed(async (_req, ctx, p) => json(await unpublishForm(ctx, p.id)));
