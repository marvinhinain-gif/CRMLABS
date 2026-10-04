import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { mergeContacts } from "@/server/services/contacts";

export const POST = authed(async (req, ctx) => {
  const { primaryId, secondaryId } = await parseBody(req, z.object({ primaryId: z.string().uuid(), secondaryId: z.string().uuid() }));
  return json(await mergeContacts(ctx, primaryId, secondaryId));
});
