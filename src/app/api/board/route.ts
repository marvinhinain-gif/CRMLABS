import { authed, json, parseQuery } from "@/server/http";
import { boardFiltersSchema, getBoard } from "@/server/services/board";

export const GET = authed(async (req, ctx) => json(await getBoard(ctx, parseQuery(req, boardFiltersSchema))));
