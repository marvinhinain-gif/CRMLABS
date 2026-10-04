import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { archiveStage } from "@/server/services/stages";

export const POST = authed(async (req, ctx, p) => {
  const { destinationStageId } = await parseBody(req, z.object({ destinationStageId: z.string().uuid().nullish() }));
  return json(await archiveStage(ctx, p.id, destinationStageId));
});
