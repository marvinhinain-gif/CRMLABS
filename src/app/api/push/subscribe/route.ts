import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { subscribe, subscribeSchema, unsubscribe } from "@/server/services/push";

/** Registra este aparelho para receber notificações (Web Push). */
export const POST = authed(async (req, ctx) => {
  const input = await parseBody(req, subscribeSchema);
  return json(await subscribe(ctx, input, req.headers.get("user-agent")));
});

export const DELETE = authed(async (req, ctx) => {
  const { endpoint } = await parseBody(req, z.object({ endpoint: z.string().max(2000) }));
  await unsubscribe(ctx, endpoint);
  return json({ ok: true });
});
