import { authed, json } from "@/server/http";
import { regenerateFeed } from "@/server/services/calendar";

/** Gera um novo link de assinatura (o anterior para de funcionar). */
export const POST = authed(async (_req, ctx) => json(await regenerateFeed(ctx)));
