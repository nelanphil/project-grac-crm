"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import RolesTab from "./RolesTab";

export default function RolesPage() {
  return (
    <AuthGuard>
      <RolesContent />
    </AuthGuard>
  );
}

function RolesContent() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const allowed = user?.role === "super-admin";

  useEffect(() => {
    if (user && !allowed) {
      router.replace("/dashboard");
    }
  }, [user, allowed, router]);

  if (!user || !allowed) return null;

  return <RolesTab />;
}
