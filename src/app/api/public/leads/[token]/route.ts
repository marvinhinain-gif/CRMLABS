import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, json } from "@/server/http";
import { receiveWebhook } from "@/server/services/integrations";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";
const MAX_BYTES = 128 * 1024;

/**
 * Webhook CRMLABS: recebe leads de formulários e quizzes externos (Typeform, Tally, Google Forms,
 * Zapier, Make, API própria). O token no endereço identifica a integração; a assinatura é validada
 * quando houver segredo configurado.
 */
export async function POST(req: NextRequest, rc: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await rc.params;
    const raw = await req.text();
    if (raw.length > MAX_BYTES) throw new AppError("invalid", "Conteúdo grande demais.");
    return json(await receiveWebhook(token, raw, req.headers), 201);
  } catch (e) {
    return errorResponse(e);
  }
}

export function GET() {
  return new NextResponse("Use POST com os dados do lead (JSON ou formulário).", { status: 405, headers: { Allow: "POST" } });
}
