import { authed, json, parseBody } from "@/server/http";
import { addLeadToBoard, addLeadToBoardSchema } from "@/server/services/leads";

/** "Adicionar ao CRM do Social Seller": cria o cartão do lead no Kanban. */
export const POST = authed(async (req, ctx, p) => json(await addLeadToBoard(ctx, p.id, await parseBody(req, addLeadToBoardSchema)), 201));
