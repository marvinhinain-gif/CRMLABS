import { authed } from "@/server/http";
import { getAvatar } from "@/server/services/avatars";

export const GET = authed(async (req, ctx, params) => {
  const row = await getAvatar(ctx, params.userId);
  const etag = `"${row.updatedAt.getTime()}"`;
  const headers = {
    "Content-Type": row.mime,
    ETag: etag,
    // URL leva a versão (?v=), então pode ficar em cache; "private" porque exige sessão.
    "Cache-Control": "private, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(row.data), { headers });
});
