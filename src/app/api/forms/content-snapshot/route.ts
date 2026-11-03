import { authed, json, parseBody } from "@/server/http";
import { snapshotContent, snapshotSchema } from "@/server/services/contentTracking";

/** Busca o conteúdo no Instagram e guarda a foto. Devolve o conteúdo pronto para anexar a um link. */
export const POST = authed(async (req, ctx) => json(await snapshotContent(ctx, await parseBody(req, snapshotSchema))));
