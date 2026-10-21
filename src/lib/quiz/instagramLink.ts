/**
 * Instagram de quem responde, sem perguntar.
 *
 * O Instagram não informa o @ de quem clica num link comum (Stories, bio, anúncio). Por isso:
 * - link personalizado: o CRM gera o link com ?ig=@da_pessoa (Direct, resposta privada, automações);
 * - link comum aberto pelo app do Instagram: a resposta fica marcada com origem Instagram.
 */
import { parseInstagramOrUrl } from "./engine";

/** Parâmetro do endereço com o @ da pessoa (?ig=fulano). */
export const IG_PARAM = "ig";

/** @ informado no link (?ig=fulano, ?ig=@fulano ou ?ig=instagram.com/fulano); valor inválido é ignorado. */
export function linkHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return parseInstagramOrUrl(raw.slice(0, 100))?.handle ?? null;
}

/** Aberto pelo navegador do app do Instagram, ou vindo de um link do Instagram. */
export function cameFromInstagram(userAgent: string | null | undefined, referrer: string | null | undefined): boolean {
  if (userAgent && /\bInstagram\b/i.test(userAgent)) return true;
  if (!referrer) return false;
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/**
 * Completa a origem quando ninguém disse de onde a pessoa veio (as UTMs do link sempre mandam).
 * Link com @: Instagram / Direct. Aberto no app do Instagram: Instagram.
 */
export function instagramUtm(utm: Record<string, string>, handle: string | null, fromInstagram: boolean): Record<string, string> {
  if (utm.utm_source) return utm;
  if (handle) return { ...utm, utm_source: "instagram", utm_medium: utm.utm_medium ?? "direct" };
  if (fromInstagram) return { ...utm, utm_source: "instagram" };
  return utm;
}

/** Link do formulário personalizado para um @ (mantém o ?origem= de um link de Direct, se houver). */
export function personalLink(baseUrl: string, handle: string, origem?: string | null): string {
  const u = new URL(baseUrl);
  if (origem) u.searchParams.set("origem", origem);
  u.searchParams.set(IG_PARAM, handle.replace(/^@/, "").toLowerCase());
  return u.toString();
}
