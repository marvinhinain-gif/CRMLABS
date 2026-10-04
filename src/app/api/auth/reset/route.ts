import { z } from "zod";
import { resetPassword } from "@/server/auth/service";
import { json, parseBody, publicRoute } from "@/server/http";

const schema = z.object({ token: z.string().min(10).max(200), password: z.string().max(200) });

export const POST = publicRoute(async (req) => {
  const { token, password } = await parseBody(req, schema);
  await resetPassword(token, password);
  return json({ ok: true });
});
