import { authed, json, parseBody } from "@/server/http";
import { googleClientSchema, googleSetupState, saveGoogleClient } from "@/server/services/calendar";

/** Credenciais do app Google (OAuth) — somente administrador. A chave secreta nunca volta. */
export const GET = authed(async (_req, ctx) => json(await googleSetupState(ctx)));
export const PUT = authed(async (req, ctx) => json(await saveGoogleClient(ctx, await parseBody(req, googleClientSchema))));
