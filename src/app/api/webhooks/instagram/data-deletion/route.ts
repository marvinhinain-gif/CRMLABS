import { NextResponse, type NextRequest } from "next/server";
import { handleDeauthorize, parseSignedRequest } from "@/server/integrations/instagram/oauth";
import { appUrl } from "@/server/env";
import { randomToken } from "@/server/crypto";

/**
 * Solicitação de exclusão de dados (exigida pela Meta). Remove credenciais e desconecta a conta;
 * a exclusão dos registros de CRM segue a política de retenção configurada (ver README).
 */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const data = parseSignedRequest(String(form?.get("signed_request") ?? ""));
  if (!data?.user_id) return new NextResponse("Invalid", { status: 400 });
  await handleDeauthorize(String(data.user_id));
  const code = randomToken(12);
  return NextResponse.json({ url: `${appUrl()}/privacidade?pedido=${code}`, confirmation_code: code });
}
