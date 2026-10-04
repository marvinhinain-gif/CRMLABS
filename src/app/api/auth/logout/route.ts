import { cookies } from "next/headers";
import { revokeSession, SESSION_COOKIE } from "@/server/auth/service";
import { json, publicRoute } from "@/server/http";

export const POST = publicRoute(async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  store.delete(SESSION_COOKIE);
  return json({ ok: true });
});
