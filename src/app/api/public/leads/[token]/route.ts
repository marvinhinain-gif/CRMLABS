import { NextResponse, type NextRequest } from "next/server";
import { errorResponse, json } from "@/server/http";
import { ingestWebhookLead } from "@/server/services/leads";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";
const MAX_BYTES = 64 * 1024;

/**
 * Recebe leads de outras ferramentas (Zapier, Make, landing pages, Lead Ads da Meta via integrador).
 * Aceita JSON ou formulário (application/x-www-form-urlencoded). O token no endereço identifica o formulário.
 */
export async function POST(req: NextRequest, rc: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await rc.params;
    const raw = await req.text();
    if (raw.length > MAX_BYTES) throw new AppError("invalid", "Conteúdo grande demais.");
    const type = req.headers.get("content-type") ?? "";
    let body: unknown;
    if (type.includes("application/x-www-form-urlencoded")) body = Object.fromEntries(new URLSearchParams(raw));
    else {
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        throw new AppError("invalid", "Envie JSON ou formulário.");
      }
    }
    return json(await ingestWebhookLead(token, body), 201);
  } catch (e) {
    return errorResponse(e);
  }
}

export function GET() {
  return new NextResponse("Use POST com os dados do lead (JSON ou formulário).", { status: 405, headers: { Allow: "POST" } });
}
