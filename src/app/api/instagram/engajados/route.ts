import { authed, json, parseQuery } from "@/server/http";
import { engagementRanking, rankingSchema } from "@/server/services/engagement";

/** Top 15 Engajados do período (hoje, semana, mês), com filtro por tipo de interação e busca. */
export const GET = authed(async (req, ctx) => json(await engagementRanking(ctx, parseQuery(req, rankingSchema))));
