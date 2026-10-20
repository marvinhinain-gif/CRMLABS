import { publicRoute } from "@/server/http";
import { getAsset } from "@/server/services/quizzes";

export const GET = publicRoute(async (_req, p) => {
  const a = await getAsset(p.id);
  return new Response(new Uint8Array(a.data), { headers: { "Content-Type": a.mime, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
});
