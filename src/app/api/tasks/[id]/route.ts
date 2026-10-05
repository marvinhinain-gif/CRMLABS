import { authed, json, parseBody } from "@/server/http";
import { deleteTask, getTask, updateTask, updateTaskSchema } from "@/server/services/tasks";

export const GET = authed(async (_req, ctx, p) => json(await getTask(ctx, p.id)));
export const PATCH = authed(async (req, ctx, p) => json(await updateTask(ctx, p.id, await parseBody(req, updateTaskSchema))));
export const DELETE = authed(async (_req, ctx, p) => {
  await deleteTask(ctx, p.id);
  return json({ ok: true });
});
