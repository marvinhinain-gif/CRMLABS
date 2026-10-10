import { z } from "zod";
import { authed, parseQuery } from "@/server/http";
import { exportResponses, responseFilterSchema } from "@/server/services/quizReports";

const schema = responseFilterSchema.extend({ format: z.enum(["csv", "xlsx"]).default("xlsx") });

/** Exporta as respostas filtradas (CSV ou XLSX). */
export const GET = authed(async (req, ctx, p) => {
  const { format, ...filters } = parseQuery(req, schema);
  const file = await exportResponses(ctx, p.id, filters, format);
  return new Response(new Uint8Array(file.body), {
    headers: { "Content-Type": file.type, "Content-Disposition": `attachment; filename="${file.filename}"`, "Cache-Control": "no-store" },
  });
});
