import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { changePassword } from "@/server/auth/service";

const schema = z.object({ current: z.string().min(1, "Informe a senha atual.").max(200), next: z.string().max(200) });

export const POST = authed(async (req, ctx) => {
  const { current, next } = await parseBody(req, schema);
  await changePassword(ctx, current, next);
  return json({ ok: true });
});
