import type { Metadata } from "next";
import { requirePageCtx } from "@/server/session";
import { can } from "@/server/permissions";
import { PreviewHost } from "@/components/forms/PreviewHost";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Prévia do formulário", robots: { index: false, follow: false } };

/**
 * Prévia ao vivo usada pelo editor (dentro de um iframe do próprio CRM).
 * Recebe o rascunho por postMessage; nada é enviado nem gravado.
 */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageCtx();
  if (!can(ctx, "forms.manage")) return <p className="p-6 text-[14px] text-muted">Sem permissão.</p>;
  return <PreviewHost formId={(await params).id} orgName={ctx.org.name} />;
}
