import { authed, json, parseBody, parseQuery } from "@/server/http";
import { createTask, listTasks, listTasksSchema, taskCounts, taskInputSchema } from "@/server/services/tasks";

export const GET = authed(async (req, ctx) => {
  const f = parseQuery(req, listTasksSchema);
  const [rows, counts] = await Promise.all([listTasks(ctx, f), taskCounts(ctx)]);
  return json({ rows, counts });
});
export const POST = authed(async (req, ctx) => json(await createTask(ctx, await parseBody(req, taskInputSchema)), 201));
