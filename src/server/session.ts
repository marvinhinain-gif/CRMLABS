import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { resolveSession, SESSION_COOKIE } from "./auth/service";

/** Contexto para Server Components. Redireciona para /login sem sessão válida. */
export async function requirePageCtx() {
  const store = await cookies();
  const ctx = await resolveSession(store.get(SESSION_COOKIE)?.value);
  if (!ctx) redirect("/login");
  return ctx;
}

export async function optionalPageCtx() {
  const store = await cookies();
  return resolveSession(store.get(SESSION_COOKIE)?.value);
}
