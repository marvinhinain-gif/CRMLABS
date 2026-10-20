import { authed, json } from "@/server/http";
import { editorOptions } from "@/server/services/quizzes";

export const GET = authed(async (_req, ctx) => json(await editorOptions(ctx)));
