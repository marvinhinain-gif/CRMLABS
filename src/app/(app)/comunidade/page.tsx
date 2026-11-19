import type { Metadata } from "next";
import { Suspense } from "react";
import { CommunityView } from "@/components/community/CommunityView";

export const metadata: Metadata = { title: "CRM da Comunidade" };

export default function Page() {
  return (
    <Suspense>
      <CommunityView />
    </Suspense>
  );
}
