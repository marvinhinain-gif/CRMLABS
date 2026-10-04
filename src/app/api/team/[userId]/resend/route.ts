import { authed, json } from "@/server/http";
import { sendInvite } from "@/server/services/team";

export const POST = authed(async (_req, ctx, p) => json(await sendInvite(ctx, p.userId)));
