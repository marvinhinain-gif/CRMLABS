import { authed, json } from "@/server/http";
import { listLogs } from "@/server/services/integrations";

export const GET = authed(async (req, ctx) => json(await listLogs(ctx, req.nextUrl.searchParams.get("integrationId") || undefined)));
