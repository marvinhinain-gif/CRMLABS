import { authed, json } from "@/server/http";
import { rejectSignup } from "@/server/auth/signup";

export const POST = authed(async (_req, ctx, p) => {
  await rejectSignup(ctx, p.userId);
  return json({ ok: true });
});
