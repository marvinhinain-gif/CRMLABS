import { authed, json, parseQuery } from "@/server/http";
import { listConversations, listConversationsSchema } from "@/server/services/conversations";

export const GET = authed(async (req, ctx) => json(await listConversations(ctx, parseQuery(req, listConversationsSchema))));
