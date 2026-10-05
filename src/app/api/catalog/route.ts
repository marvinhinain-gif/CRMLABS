import { authed, json } from "@/server/http";
import { catalog } from "@/server/services/integrations";

/** Origens, produtos e campos personalizados (só nomes). */
export const GET = authed(async (_req, ctx) => json(await catalog(ctx)));
