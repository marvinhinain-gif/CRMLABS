import { authed, json, parseBody } from "@/server/http";
import { cancelTeamEvent, getTeamEvent, updateTeamEvent, updateTeamEventSchema } from "@/server/services/teamAgenda";

export const GET = authed(async (_req, ctx, p) => json(await getTeamEvent(ctx, p.id)));
export const PATCH = authed(async (req, ctx, p) => json(await updateTeamEvent(ctx, p.id, await parseBody(req, updateTeamEventSchema))));
/** Cancela (o compromisso continua no histórico, riscado). */
export const DELETE = authed(async (_req, ctx, p) => json(await cancelTeamEvent(ctx, p.id)));
