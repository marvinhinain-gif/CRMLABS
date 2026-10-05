import { NextResponse, type NextRequest } from "next/server";
import { handleDeauthorize, parseSignedRequest } from "@/server/integrations/instagram/oauth";
import { loadInstanceSettings } from "@/server/services/instance";

/** Callback de desautorização configurado no app da Meta. */
export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  await loadInstanceSettings();
  const data = parseSignedRequest(String(form?.get("signed_request") ?? ""));
  if (!data?.user_id) return new NextResponse("Invalid", { status: 400 });
  await handleDeauthorize(String(data.user_id));
  return NextResponse.json({ ok: true });
}
