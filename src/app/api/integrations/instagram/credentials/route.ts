import { authed, json, parseBody } from "@/server/http";
import { clearInstagramCredentials, instagramCredentialsSchema, instagramSetupState, saveInstagramCredentials } from "@/server/services/instance";

/** Credenciais do app da Meta (Instagram API com Login do Instagram). A chave secreta nunca volta na resposta. */
export const GET = authed(async (_req, ctx) => json(await instagramSetupState(ctx)));

export const PUT = authed(async (req, ctx) => {
  const input = await parseBody(req, instagramCredentialsSchema);
  return json(await saveInstagramCredentials(ctx, input));
});

export const DELETE = authed(async (_req, ctx) => json(await clearInstagramCredentials(ctx)));
