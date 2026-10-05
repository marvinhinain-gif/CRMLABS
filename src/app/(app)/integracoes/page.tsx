import type { Metadata } from "next";
import { Suspense } from "react";
import { IntegrationsView } from "@/components/integrations/IntegrationsView";

export const metadata: Metadata = { title: "Integrações" };

export default function Page() {
  return (
    <Suspense>
      <IntegrationsView />
    </Suspense>
  );
}
