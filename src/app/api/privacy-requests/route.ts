import { authed, json } from "@/server/http";
import { listPrivacyRequests } from "@/server/services/quizReports";

export const GET = authed(async (_req, ctx) => json(await listPrivacyRequests(ctx)));
