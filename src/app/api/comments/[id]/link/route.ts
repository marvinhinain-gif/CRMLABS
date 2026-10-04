import { authed, json, parseBody } from "@/server/http";
import { linkCommentSchema, linkCommentToContact } from "@/server/services/comments";

export const POST = authed(async (req, ctx, p) => json(await linkCommentToContact(ctx, p.id, await parseBody(req, linkCommentSchema))));
