import type { Metadata } from "next";
import { Suspense } from "react";
import { TeamAgendaView } from "@/components/agenda/team/TeamAgendaView";

export const metadata: Metadata = { title: "Agenda da equipe" };

export default function Page() {
  return (
    <Suspense>
      <TeamAgendaView />
    </Suspense>
  );
}
