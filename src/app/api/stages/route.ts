import { z } from "zod";
import { authed, json, parseBody, parseQuery } from "@/server/http";
import { createStage, createStageSchema, listStages, pipelineKindSchema } from "@/server/services/stages";

export const GET = authed(async (req, ctx) => {
  const { kind } = parseQuery(req, z.object({ kind: pipelineKindSchema.default("relationship") }));
  return json(await listStages(ctx, kind));
});
export const POST = authed(async (req, ctx) => json(await createStage(ctx, await parseBody(req, createStageSchema)), 201));
