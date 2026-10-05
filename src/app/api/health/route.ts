/** Verificação simples de saúde (também mantém o serviço acordado no plano grátis). */
export function GET() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
