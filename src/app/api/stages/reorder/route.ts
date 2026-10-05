import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { pipelineKindSchema, reorderStages } from "@/server/services/stages";

export const POST = authed(async (req, ctx) => {
  const { kind, orderedIds, ownerId } = await parseBody(req, z.object({ kind: pipelineKindSchema, orderedIds: z.array(z.string().uuid()).min(1).max(50), ownerId: z.string().uuid().nullish() }));
  await reorderStages(ctx, kind, orderedIds, ownerId);
  return json({ ok: true });
});
