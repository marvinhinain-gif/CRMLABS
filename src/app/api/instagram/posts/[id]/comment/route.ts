import { authed, json, parseBody } from "@/server/http";
import { commentOnPost, commentOnPostSchema } from "@/server/services/instagram";

export const POST = authed(async (req, ctx, p) => json(await commentOnPost(ctx, p.id, await parseBody(req, commentOnPostSchema)), 201));
