import type { Metadata } from "next";
import { Suspense } from "react";
import { ResponsesView } from "@/components/forms/ResponsesView";

export const metadata: Metadata = { title: "Respostas do formulário" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <ResponsesView id={(await params).id} />
    </Suspense>
  );
}
