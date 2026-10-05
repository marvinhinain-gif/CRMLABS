import { authed, json, parseBody } from "@/server/http";
import { addChecklistItem, checklistItemSchema } from "@/server/services/tasks";

export const POST = authed(async (req, ctx, p) => json(await addChecklistItem(ctx, p.id, await parseBody(req, checklistItemSchema)), 201));
