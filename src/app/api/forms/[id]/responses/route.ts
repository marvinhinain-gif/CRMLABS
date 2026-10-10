import { z } from "zod";
import { authed, json, parseQuery } from "@/server/http";
import { listResponses, responseFilterSchema } from "@/server/services/quizReports";

const schema = responseFilterSchema.extend({ page: z.coerce.number().int().min(1).max(1000).default(1) });

export const GET = authed(async (req, ctx, p) => json(await listResponses(ctx, p.id, parseQuery(req, schema))));
