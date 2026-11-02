import { authed, json, parseQuery } from "@/server/http";
import { availabilitySchema, teamAvailability } from "@/server/services/calendar";

export const GET = authed(async (req, ctx) => json(await teamAvailability(ctx, parseQuery(req, availabilitySchema))));
