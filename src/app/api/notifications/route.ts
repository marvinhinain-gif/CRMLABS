import { z } from "zod";
import { authed, json, parseBody, parseQuery } from "@/server/http";
import { listNotifications, markNotificationsRead } from "@/server/services/settings";

export const GET = authed(async (req, ctx) => {
  const f = parseQuery(req, z.object({ unread: z.enum(["1", "0"]).optional(), limit: z.coerce.number().int().min(1).max(100).optional() }));
  return json(await listNotifications(ctx, { unread: f.unread === "1", limit: f.limit }));
});
export const POST = authed(async (req, ctx) => {
  const { ids } = await parseBody(req, z.object({ ids: z.array(z.string().uuid()).max(100).optional() }));
  await markNotificationsRead(ctx, ids);
  return json({ ok: true });
});
