import { authed, json, parseQuery } from "@/server/http";
import { topContentSchema, topFeed, topStories } from "@/server/services/topContent";

/** Conteúdos com mais interação que citam a palavra-chave: posts do feed ou Stories. */
export const GET = authed(async (req, ctx) => {
  const { type, q, refresh } = parseQuery(req, topContentSchema);
  return json(type === "stories" ? await topStories(ctx, { q }) : await topFeed(ctx, { q, refresh: refresh === "1" }));
});
