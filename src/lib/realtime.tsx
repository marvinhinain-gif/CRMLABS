"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";

const TOPIC_KEYS: Record<string, string[]> = {
  board: ["/api/board", "/api/dashboard", "/api/contacts", "/api/me"],
  contacts: ["/api/contacts", "/api/board", "/api/dashboard", "/api/search"],
  conversations: ["/api/conversations", "/api/me", "/api/dashboard", "/api/board", "/api/contacts/"],
  comments: ["/api/comments"],
  tasks: ["/api/tasks", "/api/dashboard", "/api/contacts/"],
  opportunities: ["/api/opportunities", "/api/appointments", "/api/dashboard", "/api/contacts/"],
  notifications: ["/api/notifications"],
  settings: ["/api/integrations", "/api/settings", "/api/me", "/api/stages", "/api/board"],
};

/**
 * Conecta ao canal de tempo real (SSE). Os eventos só dizem "algo mudou";
 * os dados são recarregados pela API, que reaplica as permissões.
 */
export function RealtimeBridge() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pending = new Set<string>();
    let flush: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      es = new EventSource("/api/realtime");
      es.onmessage = (msg) => {
        try {
          const { topic } = JSON.parse(msg.data) as { topic: string };
          for (const k of TOPIC_KEYS[topic] ?? []) pending.add(k);
          clearTimeout(flush);
          flush = setTimeout(() => {
            const prefixes = [...pending];
            pending = new Set();
            mutate((key) => typeof key === "string" && prefixes.some((p) => key.startsWith(p)));
          }, 250);
        } catch {
          /* ignora */
        }
      };
      es.onerror = () => {
        es?.close();
        retry = setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      es?.close();
      clearTimeout(retry);
      clearTimeout(flush);
    };
  }, [mutate]);
  return null;
}
