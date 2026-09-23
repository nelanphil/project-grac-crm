"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import JobRolesTab from "./JobRolesTab";

export default function JobRolesPage() {
  return (
    <AuthGuard>
      <JobRolesContent />
    </AuthGuard>
  );
}

function JobRolesContent() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const allowed = useAuthStore((s) => s.hasRole("admin", "super-admin"));

  useEffect(() => {
    if (user && !allowed) {
      router.replace("/dashboard");
    }
  }, [user, allowed, router]);

  if (!user || !allowed) return null;

  return <JobRolesTab />;
}
