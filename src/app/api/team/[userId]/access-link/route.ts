import { authed, json } from "@/server/http";
import { createAccessLink } from "@/server/services/team";

export const POST = authed(async (_req, ctx, p) => json(await createAccessLink(ctx, p.userId)));
