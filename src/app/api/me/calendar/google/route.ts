import { authed, json } from "@/server/http";
import { disconnectGoogle } from "@/server/services/calendar";

export const DELETE = authed(async (_req, ctx) => json(await disconnectGoogle(ctx)));
