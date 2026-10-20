import { authed, json } from "@/server/http";
import { instagramRelationship, refreshInstagramRelationship } from "@/server/services/igRelationship";

/** Se segue a conta e como interagiu (Direct, Stories, comentários). */
export const GET = authed(async (_req, ctx, p) => json(await instagramRelationship(ctx, p.id)));

/** Consulta de novo na API do Instagram (limitado a uma vez a cada 10 minutos). */
export const POST = authed(async (_req, ctx, p) => json(await refreshInstagramRelationship(ctx, p.id)));
