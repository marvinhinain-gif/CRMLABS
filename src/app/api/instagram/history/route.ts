import { authed, json, parseQuery } from "@/server/http";
import { historySchema, instagramHistory } from "@/server/services/instagram";

export const GET = authed(async (req, ctx) => json(await instagramHistory(ctx, parseQuery(req, historySchema))));
