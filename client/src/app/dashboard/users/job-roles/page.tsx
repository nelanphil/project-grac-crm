"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import JobRolesTab from "./JobRolesTab";

export default function JobRolesPage() {
  return (
    <AuthGuard>
      <JobRolesTab />
    </AuthGuard>
  );
}
