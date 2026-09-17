"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import UsersTab from "./UsersTab";

export default function UsersPage() {
  return (
    <AuthGuard>
      <UsersContent />
    </AuthGuard>
  );
}

function UsersContent() {
  const router = useRouter();
  const allowed = useAuthStore((s) =>
    s.hasRole("admin", "super-admin", "owner"),
  );
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (user && !allowed) {
      router.replace("/dashboard");
    }
  }, [user, allowed, router]);

  if (!user || !allowed) return null;

  return <UsersTab />;
}
