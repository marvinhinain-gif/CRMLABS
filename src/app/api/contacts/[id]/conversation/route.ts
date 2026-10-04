import { authed, json } from "@/server/http";
import { conversationForContact } from "@/server/services/conversations";

export const GET = authed(async (_req, ctx, p) => json({ id: await conversationForContact(ctx, p.id) }));
