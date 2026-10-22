import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { createFormSource } from "@/server/services/quizzes";

export const POST = authed(async (req, ctx) => json(await createFormSource(ctx, (await parseBody(req, z.object({ name: z.string().max(80) }))).name), 201));
