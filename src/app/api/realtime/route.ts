import type { NextRequest } from "next/server";
import { resolveSession, SESSION_COOKIE } from "@/server/auth/service";
import { subscribe } from "@/server/realtime";

export const dynamic = "force-dynamic";

/** Server-Sent Events com eventos de invalidação filtrados pelas permissões do usuário. */
export async function GET(req: NextRequest) {
  const ctx = await resolveSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!ctx) return new Response("Unauthorized", { status: 401 });
  const encoder = new TextEncoder();
  let cleanup: (() => void) | undefined;
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: string) => controller.enqueue(encoder.encode(data));
      send(": conectado\n\n");
      const unsubscribe = await subscribe(ctx, (e) => send(`data: ${JSON.stringify({ topic: e.topic, entityId: e.entityId ?? null })}\n\n`));
      const ping = setInterval(() => send(": ping\n\n"), 25_000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
      };
      req.signal.addEventListener("abort", () => {
        cleanup?.();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      cleanup?.();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
