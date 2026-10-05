import type { Metadata } from "next";
import { Suspense } from "react";
import { LeadsView } from "@/components/leads/LeadsView";

export const metadata: Metadata = { title: "Leads" };

export default function Page() {
  return (
    <Suspense>
      <LeadsView />
    </Suspense>
  );
}
