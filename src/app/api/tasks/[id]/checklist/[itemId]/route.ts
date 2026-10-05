import { authed, json, parseBody } from "@/server/http";
import { checklistPatchSchema, deleteChecklistItem, updateChecklistItem } from "@/server/services/tasks";

export const PATCH = authed(async (req, ctx, p) => json(await updateChecklistItem(ctx, p.id, p.itemId, await parseBody(req, checklistPatchSchema))));
export const DELETE = authed(async (_req, ctx, p) => {
  await deleteChecklistItem(ctx, p.id, p.itemId);
  return json({ ok: true });
});
