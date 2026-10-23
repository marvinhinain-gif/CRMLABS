import { authed, json, parseQuery } from "@/server/http";
import { leadSourceStats, leadSourceStatsSchema } from "@/server/services/leads";

/** Gráfico da página de Leads: quantos leads vieram de cada fonte de tráfego. */
export const GET = authed(async (req, ctx) => json(await leadSourceStats(ctx, parseQuery(req, leadSourceStatsSchema))));
