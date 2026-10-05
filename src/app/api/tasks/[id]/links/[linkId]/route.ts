import { authed, json, parseBody } from "@/server/http";
import { deleteTaskLink, taskLinkSchema, updateTaskLink } from "@/server/services/tasks";

export const PATCH = authed(async (req, ctx, p) => json(await updateTaskLink(ctx, p.id, p.linkId, await parseBody(req, taskLinkSchema.partial()))));
export const DELETE = authed(async (_req, ctx, p) => {
  await deleteTaskLink(ctx, p.id, p.linkId);
  return json({ ok: true });
});
