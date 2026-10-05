import { NextResponse, type NextRequest } from "next/server";
import { icsFeed } from "@/server/services/calendar";

export const dynamic = "force-dynamic";

/** Link de assinatura da agenda (ICS). O token no endereço é pessoal e pode ser trocado no perfil. */
export async function GET(_req: NextRequest, rc: { params: Promise<{ token: string }> }) {
  const body = await icsFeed((await rc.params).token);
  if (!body) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300", "Content-Disposition": 'inline; filename="crmlabs.ics"' },
  });
}
