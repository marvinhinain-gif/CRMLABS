import { authed, json, parseBody, parseQuery } from "@/server/http";
import { appointmentInputSchema, createAppointment, listAppointments, listAppointmentsSchema } from "@/server/services/commercial";

export const GET = authed(async (req, ctx) => json(await listAppointments(ctx, parseQuery(req, listAppointmentsSchema))));
export const POST = authed(async (req, ctx) => json(await createAppointment(ctx, await parseBody(req, appointmentInputSchema)), 201));
