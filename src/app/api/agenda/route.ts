import { authed, json, parseQuery } from "@/server/http";
import { agendaSchema, listAgenda } from "@/server/services/commercial";

export const GET = authed(async (req, ctx) => json(await listAgenda(ctx, parseQuery(req, agendaSchema))));
