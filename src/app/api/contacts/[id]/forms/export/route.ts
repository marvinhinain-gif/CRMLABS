import { authed } from "@/server/http";
import { exportContactData } from "@/server/services/quizReports";

/** LGPD: dados do titular em JSON (somente administradores). */
export const GET = authed(async (_req, ctx, p) => {
  const data = await exportContactData(ctx, p.id);
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="dados-titular-${p.id.slice(0, 8)}.json"`, "Cache-Control": "no-store" },
  });
});
