import { z } from "zod";
import { authed, json, parseQuery } from "@/server/http";
import { CONTENT_TYPES, listInstagramContent } from "@/server/services/contentTracking";

const schema = z.object({ type: z.enum(CONTENT_TYPES) });

/** Posts do feed ou Stories ativos da conta do Instagram, para escolher o conteúdo de um link. */
export const GET = authed(async (req, ctx) => json(await listInstagramContent(ctx, parseQuery(req, schema).type)));
