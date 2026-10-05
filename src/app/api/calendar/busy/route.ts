import { authed, json, parseQuery } from "@/server/http";
import { busySchema, busyTimes } from "@/server/services/calendar";

export const GET = authed(async (req, ctx) => json(await busyTimes(ctx, parseQuery(req, busySchema))));
