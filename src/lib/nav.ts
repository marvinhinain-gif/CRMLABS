"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

/** Abre o painel de contato (?contato=id) mantendo a página atual. */
export function useOpenContact() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return useCallback(
    (id: string) => {
      const next = new URLSearchParams(sp.toString());
      next.set("contato", id);
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
