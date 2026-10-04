import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { listNotifications, markNotificationsRead } from "@/server/services/settings";

export const GET = authed(async (_req, ctx) => json(await listNotifications(ctx)));
export const POST = authed(async (req, ctx) => {
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).max(100).optional() }));
  await markNotificationsRead(ctx, ids);
  return json({ ok: true });
});
