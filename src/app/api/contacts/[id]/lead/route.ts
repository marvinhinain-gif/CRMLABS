import { authed, json, parseBody } from "@/server/http";
import { leadSummary, transformLeadSchema, transformToLead } from "@/server/services/instagram";
import { notFound } from "@/server/errors";

export const GET = authed(async (_req, ctx, p) => {
  const s = await leadSummary(ctx, p.id);
  if (!s) throw notFound("Contato não encontrado.");
  return json(s);
});
/** "Transformar em Lead": só depois desta confirmação a pessoa entra no Kanban do Social Seller. */
export const POST = authed(async (req, ctx, p) => json(await transformToLead(ctx, p.id, await parseBody(req, transformLeadSchema))));
