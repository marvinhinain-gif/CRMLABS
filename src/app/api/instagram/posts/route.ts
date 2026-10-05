import { authed, json, parseQuery } from "@/server/http";
import { listCommentPosts, listPostsSchema } from "@/server/services/instagram";

export const GET = authed(async (req, ctx) => json(await listCommentPosts(ctx, parseQuery(req, listPostsSchema))));
