import { authed, json, parseBody } from "@/server/http";
import { leadContactSchema, prepareLeadContact } from "@/server/services/engagement";

/** Prepara o contato para o "Transformar em Lead" existente (não cria Lead nem cartão no Kanban). */
export const POST = authed(async (req, ctx) => json(await prepareLeadContact(ctx, await parseBody(req, leadContactSchema))));
