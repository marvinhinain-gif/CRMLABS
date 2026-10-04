import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType } from "zod";
import { AppError } from "./errors";
import { resolveSession, SESSION_COOKIE } from "./auth/service";
import type { Ctx } from "./context";
import { appUrl } from "./env";
import { logger } from "./logger";

type Params = Record<string, string>;
type RouteCtx = { params: Promise<Params> };

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

/** Proteção CSRF: mutações exigem Origin igual ao da aplicação (cookies SameSite=Lax complementam). */
function checkOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  if (!origin) throw new AppError("forbidden", "Origem da requisição ausente.");
  const allowed = new Set([new URL(appUrl()).origin, req.nextUrl.origin]);
  if (!allowed.has(origin)) throw new AppError("forbidden", "Origem da requisição não permitida.");
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) fields[issue.path.join(".") || "_"] = issue.message;
    return json({ error: { code: "invalid", message: "Verifique os campos informados.", details: { fields } } }, 422);
  }
  logger.error("Erro não tratado na API", err);
  return json({ error: { code: "internal", message: "Algo deu errado. Tente novamente em instantes." } }, 500);
}

export async function parseBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError("invalid", "Corpo da requisição inválido.");
  }
  return schema.parse(raw);
}

export function parseQuery<T>(req: NextRequest, schema: ZodType<T>): T {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
}

/** Rota autenticada: resolve sessão no servidor, aplica CSRF e mapeia erros. */
export function authed(fn: (req: NextRequest, ctx: Ctx, params: Params) => Promise<Response>) {
  return async (req: NextRequest, rc: RouteCtx) => {
    try {
      checkOrigin(req);
      const ctx = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
      if (!ctx) throw new AppError("unauthenticated", "Sua sessão expirou. Entre novamente.");
      return await fn(req, ctx, (await rc?.params) ?? {});
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Rota pública (login, recuperação, webhooks). */
export function publicRoute(fn: (req: NextRequest, params: Params) => Promise<Response>, opts = { csrf: true }) {
  return async (req: NextRequest, rc: RouteCtx) => {
    try {
      if (opts.csrf) checkOrigin(req);
      return await fn(req, (await rc?.params) ?? {});
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
}
