import { authed, json, parseQuery } from "@/server/http";
import { boardSchema, getCommercialBoard } from "@/server/services/commercial";

export const GET = authed(async (req, ctx) => json(await getCommercialBoard(ctx, parseQuery(req, boardSchema))));
