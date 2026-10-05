import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { setSigningSecret } from "@/server/services/integrations";

export const PUT = authed(async (req, ctx, p) => json(await setSigningSecret(ctx, p.id, (await parseBody(req, z.object({ secret: z.string().max(200) }))).secret)));
