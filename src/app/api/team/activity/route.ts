import { authed, json, parseQuery } from "@/server/http";
import { activityQuerySchema, listTeamActivity } from "@/server/services/activity";

export const GET = authed(async (req, ctx) => json(await listTeamActivity(ctx, parseQuery(req, activityQuerySchema))));
