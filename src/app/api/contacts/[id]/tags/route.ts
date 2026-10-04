import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { setContactTags } from "@/server/services/contacts";

export const PUT = authed(async (req, ctx, p) => {
  const { names } = await parseBody(req, z.object({ names: z.array(z.string().trim().min(1).max(40)).max(20) }));
  await setContactTags(ctx, p.id, names);
  return json({ ok: true });
});
