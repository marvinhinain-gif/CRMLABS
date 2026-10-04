import { authed, json, parseBody } from "@/server/http";
import { addEntry, addEntrySchema } from "@/server/services/board";

export const POST = authed(async (req, ctx) => json(await addEntry(ctx, await parseBody(req, addEntrySchema)), 201));
