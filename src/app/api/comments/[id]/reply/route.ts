import { authed, json, parseBody } from "@/server/http";
import { replySchema, replyToComment } from "@/server/services/comments";

export const POST = authed(async (req, ctx, p) => json(await replyToComment(ctx, p.id, await parseBody(req, replySchema))));
