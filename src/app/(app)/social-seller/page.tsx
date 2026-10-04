import type { Metadata } from "next";
import { Suspense } from "react";
import { SocialSellerView } from "@/components/social/SocialSellerView";

export const metadata: Metadata = { title: "Social Seller" };

export default function SocialSellerPage() {
  return (
    <Suspense>
      <SocialSellerView />
    </Suspense>
  );
}
