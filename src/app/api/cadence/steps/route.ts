import { authed, json, parseBody } from "@/server/http";
import { listActiveSteps, saveSteps, saveStepsSchema } from "@/server/services/cadence";

export const GET = authed(async (_req, ctx) => json({ steps: await listActiveSteps(ctx.orgId) }));

export const PUT = authed(async (req, ctx) => json({ steps: await saveSteps(ctx, await parseBody(req, saveStepsSchema)) }));
