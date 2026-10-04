import { authed, json } from "@/server/http";
import { buildMe } from "@/server/services/me";

export const GET = authed(async (_req, ctx) => json(await buildMe(ctx)));
