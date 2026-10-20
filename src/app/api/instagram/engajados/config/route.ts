import { authed, json, parseBody } from "@/server/http";
import { engagementConfigSchema, getEngagementConfig, updateEngagementConfig } from "@/server/services/engagement";
import { forbidden } from "@/server/errors";
import { can } from "@/server/permissions";

/** Pesos e critérios do Score de Engajamento (somente o administrador). */
export const GET = authed(async (_req, ctx) => {
  if (!can(ctx, "org.settings")) throw forbidden("Somente o administrador vê as regras de pontuação.");
  return json(await getEngagementConfig(ctx.orgId));
});
export const PUT = authed(async (req, ctx) => json(await updateEngagementConfig(ctx, await parseBody(req, engagementConfigSchema))));
