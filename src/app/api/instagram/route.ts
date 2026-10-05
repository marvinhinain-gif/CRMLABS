import { authed, json } from "@/server/http";
import { inboxSummary } from "@/server/services/instagram";

export const GET = authed(async (_req, ctx) => json(await inboxSummary(ctx)));
