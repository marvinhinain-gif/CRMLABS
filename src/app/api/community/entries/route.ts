import { authed, json, parseBody } from "@/server/http";
import { addLeadsToCommunity, addToCommunitySchema } from "@/server/services/community";

/** Envia leads para o CRM da Comunidade (etapa "Novo"). */
export const POST = authed(async (req, ctx) => json(await addLeadsToCommunity(ctx, await parseBody(req, addToCommunitySchema)), 201));
