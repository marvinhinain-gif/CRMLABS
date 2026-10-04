import { authed, json } from "@/server/http";
import { markRead } from "@/server/services/conversations";

export const POST = authed(async (_req, ctx, p) => {
  await markRead(ctx, p.id);
  return json({ ok: true });
});
