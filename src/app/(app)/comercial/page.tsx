import type { Metadata } from "next";
import { Suspense } from "react";
import { CommercialView } from "@/components/commercial/CommercialView";

export const metadata: Metadata = { title: "Comercial" };

export default function Page() {
  return (
    <Suspense>
      <CommercialView />
    </Suspense>
  );
}
