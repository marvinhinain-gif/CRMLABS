import { authed, json, parseBody } from "@/server/http";
import { getAgendaItem, updateAppointment, updateAppointmentSchema } from "@/server/services/commercial";

export const GET = authed(async (_req, ctx, p) => json(await getAgendaItem(ctx, p.id)));
export const PATCH = authed(async (req, ctx, p) => json(await updateAppointment(ctx, p.id, await parseBody(req, updateAppointmentSchema))));
