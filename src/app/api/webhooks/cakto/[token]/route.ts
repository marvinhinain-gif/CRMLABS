import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, json } from "@/server/http";
import { receiveCaktoWebhook } from "@/server/services/checkout";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";
const MAX_BYTES = 256 * 1024;

/**
 * Webhook da Cakto: cada venda (aprovada, reembolsada, chargeback…) chega aqui.
 * O token no endereço identifica a organização; o segredo da Cakto valida o envio.
 */
export async function POST(req: NextRequest, rc: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await rc.params;
    const raw = await req.text();
    if (raw.length > MAX_BYTES) throw new AppError("invalid", "Conteúdo grande demais.");
    return json(await receiveCaktoWebhook(token, raw, req.headers));
  } catch (e) {
    return errorResponse(e);
  }
}

export function GET() {
  return new NextResponse("Endereço do webhook da Cakto no CRMLABS. Use POST.", { status: 405, headers: { Allow: "POST" } });
}
