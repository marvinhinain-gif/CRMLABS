import { z } from "zod";
import { clientIp, json, parseBody, publicRoute } from "@/server/http";
import { submitPrivacyRequest } from "@/server/services/quizPublic";

export const dynamic = "force-dynamic";

/** Pedido do titular (LGPD): acesso, correção, exclusão ou revogação. */
export const POST = publicRoute(async (req) => json(await submitPrivacyRequest(await parseBody(req, z.unknown()), clientIp(req))));
