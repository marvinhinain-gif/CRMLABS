import { clientIp, json, parseBody, publicRoute } from "@/server/http";
import { z } from "zod";
import { submitPublicForm } from "@/server/services/leads";

export const dynamic = "force-dynamic";

/** Envio do formulário público (página /f/[slug]). Origem verificada; limite por IP. */
export const POST = publicRoute(async (req, p) => json(await submitPublicForm(p.slug, await parseBody(req, z.unknown()), clientIp(req))));
