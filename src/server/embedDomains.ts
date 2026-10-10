/**
 * Domínios autorizados a incorporar cada formulário (usado pelo proxy para montar o
 * cabeçalho Content-Security-Policy: frame-ancestors). Módulo leve: só banco e tabela.
 */
import { eq } from "drizzle-orm";
import { db } from "./db";
import { quizForms } from "./db/schema";

const cache = new Map<string, { at: number; value: string[] | null }>();

/** null = formulário inexistente; [] = qualquer site pode incorporar. */
export async function allowedDomainsFor(slug: string) {
  const hit = cache.get(slug);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  const [f] = await db.select({ d: quizForms.allowedDomains }).from(quizForms).where(eq(quizForms.slug, slug));
  const value = f ? f.d : null;
  cache.set(slug, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

export function frameAncestors(domains: string[]) {
  if (!domains.length) return "frame-ancestors *";
  return `frame-ancestors 'self' ${domains.flatMap((d) => [`https://${d}`, `http://${d}`]).join(" ")}`;
}
