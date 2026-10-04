import type { Metadata } from "next";
import { Suspense } from "react";
import { ConversationsView } from "@/components/conversations/ConversationsView";
import { PageHeaderServer } from "@/components/shell/PageHeaderServer";

export const metadata: Metadata = { title: "Conversas" };

export default function ConversationsPage() {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-col gap-5">
      <PageHeaderServer title="Conversas" subtitle="Caixa central de atendimento." />
      <Suspense>
        <ConversationsView />
      </Suspense>
    </div>
  );
}
