import { authed, json, parseBody } from "@/server/http";
import { assertCan } from "@/server/permissions";
import { boardCleanupSchema, getBoardCleanupPreview, runBoardCleanup } from "@/server/services/boardCleanup";

export const GET = authed(async (_req, ctx) => {
  assertCan(ctx, "org.settings");
  return json(await getBoardCleanupPreview(ctx));
});

export const POST = authed(async (req, ctx) => {
  assertCan(ctx, "org.settings");
  return json(await runBoardCleanup(ctx, await parseBody(req, boardCleanupSchema)));
});
