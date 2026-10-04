import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsView } from "@/components/settings/SettingsView";

export const metadata: Metadata = { title: "Configurações" };

export default function Page() {
  return (
    <Suspense>
      <SettingsView />
    </Suspense>
  );
}
