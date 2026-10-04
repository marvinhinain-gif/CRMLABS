import { authed, json, parseBody, parseQuery } from "@/server/http";
import { getConversation, messagesQuerySchema, updateConversation, updateConversationSchema } from "@/server/services/conversations";

export const GET = authed(async (req, ctx, p) => json(await getConversation(ctx, p.id, parseQuery(req, messagesQuerySchema))));
export const PATCH = authed(async (req, ctx, p) => json(await updateConversation(ctx, p.id, await parseBody(req, updateConversationSchema))));
