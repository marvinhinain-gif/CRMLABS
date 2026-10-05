import { authed, json, parseBody } from "@/server/http";
import { createForm, formInputSchema, listForms } from "@/server/services/leads";

export const GET = authed(async (_req, ctx) => json(await listForms(ctx)));
export const POST = authed(async (req, ctx) => json(await createForm(ctx, await parseBody(req, formInputSchema)), 201));
