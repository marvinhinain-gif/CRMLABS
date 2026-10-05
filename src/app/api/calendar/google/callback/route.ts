import { NextResponse, type NextRequest } from "next/server";
import { resolveSession, SESSION_COOKIE } from "@/server/auth/service";
import { handleGoogleCallback } from "@/server/services/calendar";
import { AppError } from "@/server/errors";
import { appUrl } from "@/server/env";
import { logger } from "@/server/logger";

/** Retorno do login do Google: salva a conexão da agenda e volta para o perfil. */
export async function GET(req: NextRequest) {
  const target = new URL(`${appUrl()}/configuracoes`);
  target.searchParams.set("aba", "perfil");
  try {
    const ctx = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
    const sp = req.nextUrl.searchParams;
    await handleGoogleCallback({ code: sp.get("code"), state: sp.get("state"), error: sp.get("error") }, ctx);
    target.searchParams.set("agenda", "conectada");
  } catch (e) {
    if (!(e instanceof AppError)) logger.error("Falha no retorno do Google Agenda", e);
    target.searchParams.set("agenda", "erro");
    target.searchParams.set("motivo", e instanceof AppError ? e.message : "Não foi possível conectar. Tente novamente.");
  }
  return NextResponse.redirect(target);
}
