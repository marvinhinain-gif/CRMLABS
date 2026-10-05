import { authed, json, parseBody } from "@/server/http";
import { addTaskLink, taskLinkSchema } from "@/server/services/tasks";

export const POST = authed(async (req, ctx, p) => json(await addTaskLink(ctx, p.id, await parseBody(req, taskLinkSchema)), 201));
