import { authed, json, parseQuery } from "@/server/http";
import { getQueue, queueQuerySchema } from "@/server/services/cadence";

export const GET = authed(async (req, ctx) => json(await getQueue(ctx, parseQuery(req, queueQuerySchema))));
