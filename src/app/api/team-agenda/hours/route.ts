import { authed, json, parseBody } from "@/server/http";
import { setWorkHours, workHoursSchema } from "@/server/services/calendar";

export const PUT = authed(async (req, ctx) => json(await setWorkHours(ctx, await parseBody(req, workHoursSchema))));
