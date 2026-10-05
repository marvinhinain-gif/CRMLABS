import type { Metadata } from "next";
import { Suspense } from "react";
import { AgendaView } from "@/components/agenda/AgendaView";

export const metadata: Metadata = { title: "Agendamentos" };

export default function Page() {
  return (
    <Suspense>
      <AgendaView />
    </Suspense>
  );
}
