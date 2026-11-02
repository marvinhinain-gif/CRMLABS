import { authed, json, parseBody } from "@/server/http";
import { forwardLeadSchema, forwardLeadToKanban } from "@/server/services/leads";

/** "Encaminhar para o Kanban": o lead vai para a etapa Contato do Kanban de um SDR. */
export const POST = authed(async (req, ctx, p) => json(await forwardLeadToKanban(ctx, p.id, await parseBody(req, forwardLeadSchema)), 201));
