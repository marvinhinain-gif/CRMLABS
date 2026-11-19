import { authed, json, parseQuery } from "@/server/http";
import { communityBoardSchema, getCommunityBoard } from "@/server/services/community";

export const GET = authed(async (req, ctx) => json(await getCommunityBoard(ctx, parseQuery(req, communityBoardSchema))));
