import { NextResponse, type NextRequest } from "next/server";
import { resolveSession, SESSION_COOKIE } from "@/server/auth/service";
import { handleCallback } from "@/server/integrations/instagram/oauth";
import { AppError } from "@/server/errors";
import { appUrl } from "@/server/env";
import { logger } from "@/server/logger";

/** Retorno do OAuth do Instagram: valida state + sessão do administrador e volta para Configurações. */
export async function GET(req: NextRequest) {
  const target = new URL(`${appUrl()}/configuracoes`);
  target.searchParams.set("aba", "integracoes");
  try {
    const ctx = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
    const sp = req.nextUrl.searchParams;
    const acc = await handleCallback({ code: sp.get("code"), state: sp.get("state"), error: sp.get("error") }, ctx);
    target.searchParams.set("instagram", acc.status);
  } catch (e) {
    if (!(e instanceof AppError)) logger.error("Falha no callback do Instagram", e);
    target.searchParams.set("instagram", "erro");
    target.searchParams.set("motivo", e instanceof AppError ? e.message : "Não foi possível concluir a conexão. Tente novamente.");
  }
  return NextResponse.redirect(target);
}
