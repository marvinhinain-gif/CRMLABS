import { authed, json, parseBody } from "@/server/http";
import { forwardSchema, forwardToCloser } from "@/server/services/commercial";

export const POST = authed(async (req, ctx, p) => json(await forwardToCloser(ctx, p.id, await parseBody(req, forwardSchema)), 201));
