import { authed, json, parseBody } from "@/server/http";
import { listAutoEntries, reviewAutoEntries, reviewSchema } from "@/server/services/leadReview";

/** Cartões que entraram sozinhos no Kanban (regra antiga) — revisão do administrador. */
export const GET = authed(async (_req, ctx) => json(await listAutoEntries(ctx)));
export const POST = authed(async (req, ctx) => json(await reviewAutoEntries(ctx, await parseBody(req, reviewSchema))));
