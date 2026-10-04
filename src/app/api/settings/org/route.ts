import { authed, json, parseBody } from "@/server/http";
import { getOrgSettings, orgSettingsSchema, updateOrgSettings } from "@/server/services/settings";

export const GET = authed(async (_req, ctx) => json(await getOrgSettings(ctx)));
export const PATCH = authed(async (req, ctx) => json(await updateOrgSettings(ctx, await parseBody(req, orgSettingsSchema))));
