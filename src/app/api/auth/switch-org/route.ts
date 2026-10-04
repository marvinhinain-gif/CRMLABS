import { z } from "zod";
import { switchOrg } from "@/server/auth/service";
import { authed, json, parseBody } from "@/server/http";

export const POST = authed(async (req, ctx) => {
  const { orgId } = await parseBody(req, z.object({ orgId: z.string().uuid() }));
  await switchOrg(ctx, orgId);
  return json({ ok: true });
});
