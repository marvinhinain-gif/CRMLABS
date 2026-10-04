import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { resendMessage } from "@/server/services/conversations";

export const POST = authed(async (req, ctx, p) => {
  const { clientRequestId } = await parseBody(req, z.object({ clientRequestId: z.string().uuid() }));
  return json(await resendMessage(ctx, p.id, clientRequestId));
});
