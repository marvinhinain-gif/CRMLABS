import { z } from "zod";
import { clientIp, json, parseBody, publicRoute } from "@/server/http";
import { submitQuiz } from "@/server/services/quizPublic";

export const dynamic = "force-dynamic";

/** Envio do formulário público. Score, classificação e destino são calculados aqui. */
export const POST = publicRoute(async (req, p) => json(await submitQuiz(p.slug, await parseBody(req, z.unknown()), { ip: clientIp(req), userAgent: req.headers.get("user-agent") })));
