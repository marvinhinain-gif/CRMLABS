"use client";

import { createContext, useContext } from "react";
import useSWR from "swr";
import { fetcher } from "./api";
import type { Me, Member } from "./types";

const MeContext = createContext<Me | null>(null);

export function MeProvider({ initial, children }: { initial: Me; children: React.ReactNode }) {
  const { data } = useSWR<Me>("/api/me", fetcher, { fallbackData: initial, revalidateOnMount: false });
  return <MeContext.Provider value={data ?? initial}>{children}</MeContext.Provider>;
}

export function useMe() {
  const me = useContext(MeContext);
  if (!me) throw new Error("useMe fora do MeProvider");
  return me;
}

export function useTeam() {
  const { data } = useSWR<Member[]>("/api/team", fetcher, { dedupingInterval: 60_000 });
  // Pedidos de acesso pendentes não aparecem nos seletores de responsável.
  return (data ?? []).filter((m) => m.status !== "pending");
}
