import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { previewImport } from "@/server/services/contacts";

export const POST = authed(async (req, ctx) => {
  const { csv } = await parseBody(req, z.object({ csv: z.string().max(2_000_000) }));
  return json(await previewImport(ctx, csv));
});
