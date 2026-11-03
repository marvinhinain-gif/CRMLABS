import { authed, json, parseBody } from "@/server/http";
import { addTrackedLink, addTrackedLinkSchema } from "@/server/services/contentTracking";

/** Cria um link de origem com o conteúdo (Stories, feed ou bio) que ele divulga. */
export const POST = authed(async (req, ctx, p) => json(await addTrackedLink(ctx, p.id, await parseBody(req, addTrackedLinkSchema)), 201));
