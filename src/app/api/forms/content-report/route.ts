import { authed, json, parseQuery } from "@/server/http";
import { contentReport, contentReportSchema } from "@/server/services/contentTracking";

export const GET = authed(async (req, ctx) => {
  const { days } = parseQuery(req, contentReportSchema);
  return json(await contentReport(ctx, { days: days === "all" ? "all" : (Number(days) as 7 | 30 | 90) }));
});
