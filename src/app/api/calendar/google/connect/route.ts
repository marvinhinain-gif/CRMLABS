import { authed, json } from "@/server/http";
import { startGoogleConnect } from "@/server/services/calendar";

export const POST = authed(async (_req, ctx) => json(await startGoogleConnect(ctx)));
