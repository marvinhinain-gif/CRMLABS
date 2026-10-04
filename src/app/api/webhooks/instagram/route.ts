import { NextResponse, type NextRequest } from "next/server";
import { instagramConfig } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { ingestWebhook, processPendingEvents, verifySignature } from "@/server/integrations/instagram/webhooks";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/** Verificação do endpoint pela Meta (hub.challenge). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const token = instagramConfig().verifyToken;
  if (sp.get("hub.mode") === "subscribe" && token && safeEqual(sp.get("hub.verify_token") ?? "", token)) {
    return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/** Recebe eventos: valida assinatura, persiste na fila e responde rápido. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    logger.warn("Webhook do Instagram com assinatura inválida");
    return new NextResponse("Invalid signature", { status: 401 });
  }
  try {
    await ingestWebhook(raw);
  } catch (e) {
    logger.error("Falha ao enfileirar webhook", e);
    return new NextResponse("Retry", { status: 500 }); // a Meta reenvia
  }
  // Processamento assíncrono; o worker (npm run worker) também consome a fila.
  void processPendingEvents(20).catch((e) => logger.error("Falha ao processar fila", e));
  return new NextResponse("EVENT_RECEIVED", { status: 200 });
}
