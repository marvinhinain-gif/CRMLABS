import type { Metadata } from "next";
import { Suspense } from "react";
import { FormEditor } from "@/components/forms/editor/FormEditor";

export const metadata: Metadata = { title: "Editar formulário" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <FormEditor id={(await params).id} />
    </Suspense>
  );
}
