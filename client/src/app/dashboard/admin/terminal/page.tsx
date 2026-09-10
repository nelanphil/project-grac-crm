"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { LegacyDumpTerminalPage } from "@/components/admin/LegacyDatabaseSection";
import { useAuthStore } from "@/store/useAuthStore";

export default function AdminTerminalPopoutPage() {
  return (
    <AuthGuard>
      <AdminTerminalPopout />
    </AuthGuard>
  );
}

function AdminTerminalPopout() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === "super-admin";

  function popIn() {
    if (window.opener && !window.opener.closed) {
      window.opener.focus();
      window.close();
      return;
    }
    router.replace("/dashboard/admin/?tab=database");
  }

  useEffect(() => {
    document.title = "Backend terminal";
  }, []);

  useEffect(() => {
    if (user && !isSuperAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isSuperAdmin, router]);

  if (!user || !isSuperAdmin) return null;

  return <LegacyDumpTerminalPage token={token} onPopIn={popIn} />;
}
