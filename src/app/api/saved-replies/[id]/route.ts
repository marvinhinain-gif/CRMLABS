import { authed, json } from "@/server/http";
import { deleteSavedReply } from "@/server/services/conversations";

export const DELETE = authed(async (_req, ctx, p) => {
  await deleteSavedReply(ctx, p.id);
  return json({ ok: true });
});
