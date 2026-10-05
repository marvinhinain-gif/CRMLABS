import { authed, json, parseBody } from "@/server/http";
import { deleteIntegration, getIntegration, integrationUpdateSchema, updateIntegration } from "@/server/services/integrations";

export const GET = authed(async (_req, ctx, p) => json(await getIntegration(ctx, p.id)));
export const PATCH = authed(async (req, ctx, p) => json(await updateIntegration(ctx, p.id, await parseBody(req, integrationUpdateSchema))));
export const DELETE = authed(async (_req, ctx, p) => {
  await deleteIntegration(ctx, p.id);
  return json({ ok: true });
});
