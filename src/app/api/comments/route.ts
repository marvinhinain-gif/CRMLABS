import { authed, json, parseQuery } from "@/server/http";
import { listComments, listCommentsSchema } from "@/server/services/comments";

export const GET = authed(async (req, ctx) => json(await listComments(ctx, parseQuery(req, listCommentsSchema))));
