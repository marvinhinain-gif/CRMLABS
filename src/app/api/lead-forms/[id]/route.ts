import { authed, json, parseBody } from "@/server/http";
import { deleteForm, formUpdateSchema, updateForm } from "@/server/services/leads";

export const PATCH = authed(async (req, ctx, p) => json(await updateForm(ctx, p.id, await parseBody(req, formUpdateSchema))));
export const DELETE = authed(async (_req, ctx, p) => {
  await deleteForm(ctx, p.id);
  return json({ ok: true });
});
