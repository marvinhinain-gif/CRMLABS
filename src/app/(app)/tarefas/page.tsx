import type { Metadata } from "next";
import { Suspense } from "react";
import { TasksView } from "@/components/tasks/TasksView";

export const metadata: Metadata = { title: "Tarefas" };

export default function Page() {
  return (
    <Suspense>
      <TasksView />
    </Suspense>
  );
}
