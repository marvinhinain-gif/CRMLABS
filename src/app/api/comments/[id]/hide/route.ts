import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { hideComment } from "@/server/services/instagram";

export const POST = authed(async (req, ctx, p) => {
  const { hide } = await parseBody(req, z.object({ hide: z.boolean() }));
  await hideComment(ctx, p.id, hide);
  return json({ ok: true });
});
