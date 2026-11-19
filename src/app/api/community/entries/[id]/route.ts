import { authed, json } from "@/server/http";
import { removeCommunityEntry } from "@/server/services/community";

export const DELETE = authed(async (_req, ctx, p) => {
  await removeCommunityEntry(ctx, p.id);
  return json({ ok: true });
});
