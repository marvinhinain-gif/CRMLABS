import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { pipelineKindSchema, reorderStages } from "@/server/services/stages";

export const POST = authed(async (req, ctx) => {
  const { kind, orderedIds } = await parseBody(req, z.object({ kind: pipelineKindSchema, orderedIds: z.array(z.string().uuid()).min(1).max(50) }));
  await reorderStages(ctx, kind, orderedIds);
  return json({ ok: true });
});
