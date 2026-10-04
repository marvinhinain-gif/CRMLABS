import { authed, json, parseBody } from "@/server/http";
import { updateStage, updateStageSchema } from "@/server/services/stages";

export const PATCH = authed(async (req, ctx, p) => json(await updateStage(ctx, p.id, await parseBody(req, updateStageSchema))));
