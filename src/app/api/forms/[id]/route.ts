import { authed, json, parseBody } from "@/server/http";
import { deleteForm, getForm, saveDraft, saveDraftSchema } from "@/server/services/quizzes";

export const GET = authed(async (_req, ctx, p) => json(await getForm(ctx, p.id)));
/** Salva o rascunho (o que está no ar só muda ao publicar). */
export const PATCH = authed(async (req, ctx, p) => json(await saveDraft(ctx, p.id, await parseBody(req, saveDraftSchema))));
export const DELETE = authed(async (_req, ctx, p) => {
  await deleteForm(ctx, p.id);
  return json({ ok: true });
});
