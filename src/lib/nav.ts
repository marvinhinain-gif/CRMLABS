"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Aba do painel de contato que pode ser aberta direto pela URL (?aba-contato=cadencia). */
export const CONTACT_TAB_PARAM = "aba-contato";

/** Abre o painel de contato (?contato=id) mantendo a página atual. `opts.tab` abre direto numa aba (ex.: "cadencia"). */
export function useOpenContact() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return useCallback(
    (id: string, opts?: { tab?: string }) => {
      const next = new URLSearchParams(sp.toString());
      next.set("contato", id);
      if (opts?.tab) next.set(CONTACT_TAB_PARAM, opts.tab);
      else next.delete(CONTACT_TAB_PARAM);
      router.push(`${pathname}?${next}`, { scroll: false });
    },
    [router, pathname, sp],
  );
}

/** Lê/atualiza um parâmetro da URL (filtros preservados ao navegar). */
export function useQueryParam(name: string, fallback = "") {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const value = sp.get(name) ?? fallback;
  const set = useCallback(
    (v: string | null) => {
      const next = new URLSearchParams(sp.toString());
      if (v === null || v === "" || v === fallback) next.delete(name);
      else next.set(name, v);
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [router, pathname, sp, name, fallback],
  );
  return [value, set] as const;
}

/** Atualiza vários parâmetros da URL de uma vez (dois setters seguidos perderiam o primeiro). */
export function useSetQueryParams() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return useCallback(
    (values: Record<string, string | null>, fallbacks: Record<string, string> = {}) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(values)) {
        if (v === null || v === "" || v === fallbacks[k]) next.delete(k);
        else next.set(k, v);
      }
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [router, pathname, sp],
  );
}
