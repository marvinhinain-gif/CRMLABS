import { z } from "zod";
import { cookies } from "next/headers";
import { acceptInvite, getInvite, SESSION_COOKIE } from "@/server/auth/service";
import { json, parseBody, publicRoute } from "@/server/http";
import { AppError } from "@/server/errors";
import { secureCookies } from "@/server/env";

export const GET = publicRoute(async (req) => {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const invite = token ? await getInvite(token) : null;
  if (!invite) throw new AppError("invalid", "Convite inválido, expirado ou já utilizado.");
  return json(invite);
});

const schema = z.object({ token: z.string().min(10).max(200), password: z.string().max(200).nullable(), name: z.string().max(120).optional() });

export const POST = publicRoute(async (req) => {
  const input = await parseBody(req, schema);
  const r = await acceptInvite(input.token, input.password, input.name);
  (await cookies()).set(SESSION_COOKIE, r.token, { httpOnly: true, secure: secureCookies(), sameSite: "lax", path: "/" });
  return json({ ok: true });
});
