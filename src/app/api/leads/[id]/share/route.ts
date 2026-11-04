import { authed, json } from "@/server/http";
import { shareLead, unshareLead } from "@/server/services/leadShare";

/** Link público da ficha do lead: POST cria (ou devolve o atual), DELETE desativa. */
export const POST = authed(async (_req, ctx, p) => json(await shareLead(ctx, p.id)));
export const DELETE = authed(async (_req, ctx, p) => json(await unshareLead(ctx, p.id)));
