import { authed, json } from "@/server/http";
import { reconcileMessage } from "@/server/services/conversations";

export const POST = authed(async (_req, ctx, p) => json(await reconcileMessage(ctx, p.id)));
