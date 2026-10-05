import { z } from "zod";
import { authed, json, parseBody } from "@/server/http";
import { createLeadFromInstagram, leadSummary } from "@/server/services/instagram";
import { notFound } from "@/server/errors";

export const GET = authed(async (_req, ctx, p) => {
  const s = await leadSummary(ctx, p.id);
  if (!s) throw notFound("Contato não encontrado.");
  return json(s);
});
export const POST = authed(async (req, ctx, p) => {
  const { from } = await parseBody(req, z.object({ from: z.enum(["direct", "comment"]).default("direct") }));
  return json(await createLeadFromInstagram(ctx, p.id, from));
});
