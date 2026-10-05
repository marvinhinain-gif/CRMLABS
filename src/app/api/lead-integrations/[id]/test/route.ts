import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { testIntegration } from "@/server/services/integrations";

/** Testa a integração com um envio de exemplo (não cria lead). */
export const POST = authed(async (req, ctx, p) => json(await testIntegration(ctx, p.id, (await parseBody(req, z.object({ sample: z.unknown().optional() }))).sample)));
