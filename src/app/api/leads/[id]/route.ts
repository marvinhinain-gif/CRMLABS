import { authed, json, parseBody } from "@/server/http";
import { getLead, updateLead, updateLeadSchema } from "@/server/services/leads";

export const GET = authed(async (_req, ctx, p) => json(await getLead(ctx, p.id)));
export const PATCH = authed(async (req, ctx, p) => json(await updateLead(ctx, p.id, await parseBody(req, updateLeadSchema))));
