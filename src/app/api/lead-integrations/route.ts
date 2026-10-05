import { authed, json, parseBody } from "@/server/http";
import { createIntegration, integrationInputSchema, listIntegrations } from "@/server/services/integrations";

export const GET = authed(async (_req, ctx) => json(await listIntegrations(ctx)));
export const POST = authed(async (req, ctx) => json(await createIntegration(ctx, await parseBody(req, integrationInputSchema)), 201));
