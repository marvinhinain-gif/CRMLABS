import { authed, json, parseBody } from "@/server/http";
import { updateComment, updateCommentSchema } from "@/server/services/comments";

export const PATCH = authed(async (req, ctx, p) => {
  await updateComment(ctx, p.id, await parseBody(req, updateCommentSchema));
  return json({ ok: true });
});
