import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { reorderChecklist } from "@/server/services/tasks";

export const POST = authed(async (req, ctx, p) => {
  const { orderedIds } = await parseBody(req, z.object({ orderedIds: z.array(z.string().uuid()).max(100) }));
  await reorderChecklist(ctx, p.id, orderedIds);
  return json({ ok: true });
});
