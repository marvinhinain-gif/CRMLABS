import { z } from "zod";
import { authed, json, parseBody, parseQuery } from "@/server/http";
import { createStage, createStageSchema, listStages, pipelineKindSchema } from "@/server/services/stages";

export const GET = authed(async (req, ctx) => {
  const { kind, ownerId } = parseQuery(req, z.object({ kind: pipelineKindSchema.default("relationship"), ownerId: z.string().uuid().optional() }));
  return json(await listStages(ctx, kind, { ownerId }));
});
export const POST = authed(async (req, ctx) => json(await createStage(ctx, await parseBody(req, createStageSchema)), 201));
