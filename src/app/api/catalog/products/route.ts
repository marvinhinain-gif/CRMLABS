import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { createProduct } from "@/server/services/integrations";

export const POST = authed(async (req, ctx) => json(await createProduct(ctx, (await parseBody(req, z.object({ name: z.string().max(80) }))).name), 201));
