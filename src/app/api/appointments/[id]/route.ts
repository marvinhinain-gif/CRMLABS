import { authed, json, parseBody } from "@/server/http";
import { updateAppointment, updateAppointmentSchema } from "@/server/services/commercial";

export const PATCH = authed(async (req, ctx, p) => json(await updateAppointment(ctx, p.id, await parseBody(req, updateAppointmentSchema))));
