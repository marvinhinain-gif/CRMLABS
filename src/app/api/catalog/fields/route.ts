import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { createCustomField } from "@/server/services/integrations";

export const POST = authed(async (req, ctx) => json(await createCustomField(ctx, (await parseBody(req, z.object({ name: z.string().max(80) }))).name), 201));
