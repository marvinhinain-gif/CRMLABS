import { authed, json } from "@/server/http";
import { shareableForms } from "@/server/services/quizzes";

/** Formulários publicados, para enviar o link personalizado a alguém pelo Direct. */
export const GET = authed(async (_req, ctx) => json(await shareableForms(ctx)));
