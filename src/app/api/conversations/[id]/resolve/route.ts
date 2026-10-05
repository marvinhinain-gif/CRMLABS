import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { resolveConversation } from "@/server/services/conversations";

export const POST = authed(async (req, ctx, p) => {
  const { resolved } = await parseBody(req, z.object({ resolved: z.boolean().default(true) }));
  return json(await resolveConversation(ctx, p.id, resolved));
});
