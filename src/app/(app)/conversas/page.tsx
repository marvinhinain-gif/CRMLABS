import { redirect } from "next/navigation";

/** A caixa de conversas agora vive em Instagram → Directs (links antigos continuam funcionando). */
export default async function ConversationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const c = typeof sp.c === "string" ? `&c=${encodeURIComponent(sp.c)}` : "";
  redirect(`/instagram?aba=directs${c}`);
}
