import type { Metadata } from "next";
import { Suspense } from "react";
import { InstagramView } from "@/components/instagram/InstagramView";

export const metadata: Metadata = { title: "Instagram" };

export default function InstagramPage() {
  return (
    <Suspense>
      <InstagramView />
    </Suspense>
  );
}
