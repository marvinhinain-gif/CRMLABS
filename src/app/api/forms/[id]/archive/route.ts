import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { archiveForm } from "@/server/services/quizzes";

export const POST = authed(async (req, ctx, p) => json(await archiveForm(ctx, p.id, (await parseBody(req, z.object({ archived: z.boolean() }))).archived)));
