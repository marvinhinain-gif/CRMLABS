import { authed, json, parseBody } from "@/server/http";
import { icpSchema, setEngagementIcp } from "@/server/services/engagement";

/** Marca a pessoa como ICP, "não é ICP" (sai do Top 15) ou limpa a marcação. */
export const POST = authed(async (req, ctx) => json(await setEngagementIcp(ctx, await parseBody(req, icpSchema))));
