import { authed, json, parseBody } from "@/server/http";
import { scheduleLead, scheduleLeadSchema } from "@/server/services/leads";

/** Confirma a reunião com o lead (cria o agendamento). */
export const POST = authed(async (req, ctx, p) => json(await scheduleLead(ctx, p.id, await parseBody(req, scheduleLeadSchema)), 201));
