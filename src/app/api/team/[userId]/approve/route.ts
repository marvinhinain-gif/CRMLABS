import { authed, json, parseBody } from "@/server/http";
import { approveSchema, approveSignup } from "@/server/auth/signup";

export const POST = authed(async (req, ctx, p) => {
  await approveSignup(ctx, p.userId, await parseBody(req, approveSchema));
  return json({ ok: true });
});
