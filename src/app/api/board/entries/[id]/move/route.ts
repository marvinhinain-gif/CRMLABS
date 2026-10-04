import { authed, json, parseBody } from "@/server/http";
import { moveEntry, moveEntrySchema } from "@/server/services/board";

export const POST = authed(async (req, ctx, p) => json(await moveEntry(ctx, p.id, await parseBody(req, moveEntrySchema))));
