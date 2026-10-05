import { authed, json, parseBody } from "@/server/http";
import { goalSchema, listGoals, setGoal } from "@/server/services/metrics";

export const GET = authed(async (_req, ctx) => json(await listGoals(ctx)));
export const PUT = authed(async (req, ctx) => json(await setGoal(ctx, await parseBody(req, goalSchema))));
