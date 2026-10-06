import { authed, json } from "@/server/http";
import { transformLeadOptions } from "@/server/services/instagram";

export const GET = authed(async (_req, ctx) => json(await transformLeadOptions(ctx)));
