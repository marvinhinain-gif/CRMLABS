import { authed, json } from "@/server/http";
import { sendTest } from "@/server/services/push";

export const POST = authed(async (_req, ctx) => json(await sendTest(ctx)));
