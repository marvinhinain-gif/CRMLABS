import { authed, json, parseBody } from "@/server/http";
import { updateMember, updateMemberSchema } from "@/server/services/team";

export const PATCH = authed(async (req, ctx, p) => {
  await updateMember(ctx, p.userId, await parseBody(req, updateMemberSchema));
  return json({ ok: true });
});
