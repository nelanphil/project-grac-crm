"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import TasksWorkspace from "@/components/tasks/TasksWorkspace";

export default function TasksPage() {
  return (
    <AuthGuard>
      <TasksWorkspace />
    </AuthGuard>
  );
}
