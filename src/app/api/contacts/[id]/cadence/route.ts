import { authed, json, parseBody } from "@/server/http";
import { applyCadenceAction, cadenceActionSchema, getContactCadence } from "@/server/services/cadence";

export const GET = authed(async (_req, ctx, p) => json(await getContactCadence(ctx, p.id)));

export const POST = authed(async (req, ctx, p) => json(await applyCadenceAction(ctx, p.id, await parseBody(req, cadenceActionSchema))));
