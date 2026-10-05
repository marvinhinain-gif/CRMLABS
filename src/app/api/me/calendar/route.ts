import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { myCalendar, updatePrefs } from "@/server/services/calendar";

export const GET = authed(async (_req, ctx) => json(await myCalendar(ctx)));
export const PATCH = authed(async (req, ctx) => json(await updatePrefs(ctx, await parseBody(req, z.object({ createMeet: z.boolean().optional() })))));
