import { authed, json, parseBody } from "@/server/http";
import { moveCommunityEntry, moveCommunitySchema } from "@/server/services/community";

export const POST = authed(async (req, ctx, p) => json(await moveCommunityEntry(ctx, p.id, await parseBody(req, moveCommunitySchema))));
