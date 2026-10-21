import { authed, json } from "@/server/http";
import { regenerateCaktoUrl } from "@/server/services/checkout";

export const POST = authed(async (_req, ctx) => json(await regenerateCaktoUrl(ctx)));
