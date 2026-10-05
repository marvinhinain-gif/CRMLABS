import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { resolveComment } from "@/server/services/instagram";

export const POST = authed(async (req, ctx, p) => {
  const { resolved } = await parseBody(req, z.object({ resolved: z.boolean().default(true) }));
  await resolveComment(ctx, p.id, resolved);
  return json({ ok: true });
});
