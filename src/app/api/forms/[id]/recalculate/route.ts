import { authed, json, parseBody } from "@/server/http";
import { recalcSchema, recalculate } from "@/server/services/quizReports";

/** Recalcula o score com as regras da última versão publicada (o cálculo anterior fica no histórico). */
export const POST = authed(async (req, ctx, p) => json(await recalculate(ctx, p.id, await parseBody(req, recalcSchema))));
