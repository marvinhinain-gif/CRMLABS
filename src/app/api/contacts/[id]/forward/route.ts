import { authed, json, parseBody } from "@/server/http";
import { forwardSchema, forwardStatus, forwardToCloser } from "@/server/services/commercial";

export const GET = authed(async (_req, ctx, p) => json(await forwardStatus(ctx, p.id)));
export const POST = authed(async (req, ctx, p) => json(await forwardToCloser(ctx, p.id, await parseBody(req, forwardSchema)), 201));
