"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import UsersTab from "./UsersTab";

const ALLOWED_ROLES = ["admin", "super-admin", "owner"];

export default function UsersPage() {
  return (
    <AuthGuard>
      <UsersContent />
    </AuthGuard>
  );
}

function UsersContent() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const allowed = user ? ALLOWED_ROLES.includes(user.role) : false;

  useEffect(() => {
    if (user && !allowed) {
      router.replace("/dashboard");
    }
  }, [user, allowed, router]);

  if (!user || !allowed) return null;

  return <UsersTab />;
}
