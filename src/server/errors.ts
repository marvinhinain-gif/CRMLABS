export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "rate_limited"
  | "channel_unavailable"
  | "provider_error"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 422,
  conflict: 409,
  rate_limited: 429,
  channel_unavailable: 422,
  provider_error: 502,
  internal: 500,
};

/** Erro de domínio com mensagem segura para exibir ao usuário. */
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
}

export const forbidden = (msg = "Você não tem permissão para esta ação.") => new AppError("forbidden", msg);
export const notFound = (msg = "Registro não encontrado.") => new AppError("not_found", msg);
export const invalid = (msg: string, details?: Record<string, unknown>) => new AppError("invalid", msg, details);
