import { authed, json, parseBody } from "@/server/http";
import { sendMessage, sendSchema } from "@/server/services/conversations";

export const POST = authed(async (req, ctx, p) => json(await sendMessage(ctx, p.id, await parseBody(req, sendSchema))));
