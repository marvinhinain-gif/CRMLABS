import { authed, json } from "@/server/http";
import { listTags } from "@/server/services/contacts";

export const GET = authed(async (_req, ctx) => json(await listTags(ctx)));
