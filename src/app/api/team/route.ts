import { authed, json, parseBody } from "@/server/http";
import { inviteMember, inviteSchema, listMembers } from "@/server/services/team";

export const GET = authed(async (_req, ctx) => json(await listMembers(ctx)));
export const POST = authed(async (req, ctx) => json(await inviteMember(ctx, await parseBody(req, inviteSchema)), 201));
