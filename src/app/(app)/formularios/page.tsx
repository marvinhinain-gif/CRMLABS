import type { Metadata } from "next";
import { Suspense } from "react";
import { FormsView } from "@/components/forms/FormsView";

export const metadata: Metadata = { title: "Formulários & Quizzes" };

export default function Page() {
  return (
    <Suspense>
      <FormsView />
    </Suspense>
  );
}
