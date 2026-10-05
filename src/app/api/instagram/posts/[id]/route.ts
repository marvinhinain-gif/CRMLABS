import { authed, json } from "@/server/http";
import { getPostThread } from "@/server/services/instagram";

export const GET = authed(async (_req, ctx, p) => json(await getPostThread(ctx, p.id)));
