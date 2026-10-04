import { authed, json } from "@/server/http";
import { closeEntry } from "@/server/services/board";

export const DELETE = authed(async (_req, ctx, p) => {
  await closeEntry(ctx, p.id);
  return json({ ok: true });
});
