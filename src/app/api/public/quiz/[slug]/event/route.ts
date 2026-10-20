import { z } from "zod";
import { clientIp, json, parseBody, publicRoute } from "@/server/http";
import { recordEvent } from "@/server/services/quizPublic";

export const dynamic = "force-dynamic";

/** Visualização e início do formulário (uma vez por sessão). */
export const POST = publicRoute(async (req, p) => json(await recordEvent(p.slug, await parseBody(req, z.unknown()), clientIp(req))));
