import { authed, json } from "@/server/http";
import { resolvePrivacyRequest } from "@/server/services/quizReports";

/** Marca o pedido do titular como atendido. */
export const PATCH = authed(async (_req, ctx, p) => json(await resolvePrivacyRequest(ctx, p.id)));
