import { authed, json, parseBody } from "@/server/http";
import { getPrefs, prefsSchema, setPrefs } from "@/server/services/push";

/** Preferências de notificação do usuário e a chave pública para inscrever aparelhos. */
export const GET = authed(async (_req, ctx) => json(await getPrefs(ctx)));

export const PUT = authed(async (req, ctx) => json(await setPrefs(ctx, await parseBody(req, prefsSchema))));
