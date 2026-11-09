import { authed, parseQuery } from "@/server/http";
import { exportLeads, exportLeadsSchema } from "@/server/services/leads";

/** Baixa os leads da lista (mesma aba e filtros) com todas as respostas, em Excel (.xlsx) ou CSV. */
export const GET = authed(async (req, ctx) => {
  const file = await exportLeads(ctx, parseQuery(req, exportLeadsSchema));
  return new Response(new Uint8Array(file.body), {
    headers: { "Content-Type": file.type, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
});
