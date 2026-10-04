import { authed, json } from "@/server/http";
import { syncComments } from "@/server/services/comments";

export const POST = authed(async (_req, ctx) => json(await syncComments(ctx)));
