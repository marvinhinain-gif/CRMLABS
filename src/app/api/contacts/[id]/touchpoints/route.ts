import { authed, json, parseBody } from "@/server/http";
import { addTouchpoint, touchpointSchema } from "@/server/services/journey";

/** Registrar manualmente uma nova origem/ponto de contato do contato. */
export const POST = authed(async (req, ctx, p) => json(await addTouchpoint(ctx, p.id, await parseBody(req, touchpointSchema)), 201));
