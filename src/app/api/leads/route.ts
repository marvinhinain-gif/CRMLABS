import { authed, json, parseQuery } from "@/server/http";
import { listLeads, listLeadsSchema } from "@/server/services/leads";

export const GET = authed(async (req, ctx) => json(await listLeads(ctx, parseQuery(req, listLeadsSchema))));
