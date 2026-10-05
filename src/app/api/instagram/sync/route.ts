import { authed, json } from "@/server/http";
import { syncNow } from "@/server/services/instagram";

export const POST = authed(async (_req, ctx) => json(await syncNow(ctx)));
