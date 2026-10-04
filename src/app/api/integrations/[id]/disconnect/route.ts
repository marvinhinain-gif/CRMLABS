import { authed, json } from "@/server/http";
import { disconnectAccount } from "@/server/integrations/instagram/oauth";

export const POST = authed(async (_req, ctx, p) => {
  await disconnectAccount(ctx, p.id);
  return json({ ok: true });
});
