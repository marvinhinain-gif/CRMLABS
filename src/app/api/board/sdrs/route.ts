import { authed, json } from "@/server/http";
import { listSdrBoards } from "@/server/services/board";

export const GET = authed(async (_req, ctx) => json(await listSdrBoards(ctx)));
