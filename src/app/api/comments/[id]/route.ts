import { authed, json, parseBody } from "@/server/http";
import { updateComment, updateCommentSchema } from "@/server/services/comments";
import { deleteComment } from "@/server/services/instagram";

export const PATCH = authed(async (req, ctx, p) => {
  await updateComment(ctx, p.id, await parseBody(req, updateCommentSchema));
  return json({ ok: true });
});
export const DELETE = authed(async (_req, ctx, p) => {
  await deleteComment(ctx, p.id);
  return json({ ok: true });
});
