import { z } from "zod";
import { cookies } from "next/headers";
import { login, SESSION_COOKIE } from "@/server/auth/service";
import { clientIp, json, parseBody, publicRoute } from "@/server/http";
import { secureCookies } from "@/server/env";

const schema = z.object({ email: z.string().trim().email("Informe um e-mail válido.").max(200), password: z.string().min(1, "Informe a senha.").max(200), remember: z.boolean().default(false) });

export const POST = publicRoute(async (req) => {
  const input = await parseBody(req, schema);
  const r = await login({ ...input, ip: clientIp(req), userAgent: req.headers.get("user-agent") });
  (await cookies()).set(SESSION_COOKIE, r.token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: "lax",
    path: "/",
    // "Lembrar de mim" só altera a duração do cookie/sessão; a senha nunca é armazenada.
    ...(r.remember ? { expires: r.expiresAt } : {}),
  });
  return json({ ok: true });
});
