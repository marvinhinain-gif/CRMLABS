import { z } from "zod";
import { authed, json, parseQuery } from "@/server/http";
import { boardFiltersSchema, getColumnPage } from "@/server/services/board";

export const GET = authed(async (req, ctx, p) => {
  const q = parseQuery(req, boardFiltersSchema.extend({ offset: z.coerce.number().int().min(0).max(100000).default(0) }));
  const { offset, ...filters } = q;
  return json(await getColumnPage(ctx, p.stageId, offset, filters));
});
