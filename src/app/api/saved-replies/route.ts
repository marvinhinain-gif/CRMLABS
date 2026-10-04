import { authed, json, parseBody } from "@/server/http";
import { createSavedReply, listSavedReplies, savedReplySchema } from "@/server/services/conversations";

export const GET = authed(async (_req, ctx) => json(await listSavedReplies(ctx)));
export const POST = authed(async (req, ctx) => json(await createSavedReply(ctx, await parseBody(req, savedReplySchema)), 201));
