import { authed, json, parseBody, parseQuery } from "@/server/http";
import { createTeamEvent, listTeamAgenda, teamAgendaSchema, teamEventInputSchema } from "@/server/services/teamAgenda";

export const GET = authed(async (req, ctx) => json(await listTeamAgenda(ctx, parseQuery(req, teamAgendaSchema))));
export const POST = authed(async (req, ctx) => json(await createTeamEvent(ctx, await parseBody(req, teamEventInputSchema)), 201));
