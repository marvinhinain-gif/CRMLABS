import { authed, json } from "@/server/http";
import { resolveAllOnPost } from "@/server/services/instagram";

export const POST = authed(async (_req, ctx, p) => json(await resolveAllOnPost(ctx, p.id)));
