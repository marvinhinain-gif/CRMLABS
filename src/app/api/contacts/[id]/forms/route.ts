import { authed, json } from "@/server/http";
import { contactSubmissions } from "@/server/services/quizReports";

/** Aba "Formulários respondidos" do contato (mesma visibilidade do contato). */
export const GET = authed(async (_req, ctx, p) => json(await contactSubmissions(ctx, p.id)));
