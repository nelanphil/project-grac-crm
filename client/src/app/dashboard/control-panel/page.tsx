"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import ContractsCard from "@/components/control-panel/ContractsCard";
import TwilioAccountsCard from "@/components/control-panel/TwilioAccountsCard";
import { useAuthStore } from "@/store/useAuthStore";

const ADMIN_ROLES = ["admin", "super-admin", "owner"];

export default function ControlPanelPage() {
  return (
    <AuthGuard>
      <ControlPanelContent />
    </AuthGuard>
  );
}

function ControlPanelContent() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  useEffect(() => {
    if (user && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isAdmin, router]);

  if (!user || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Control Panel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manage integrations and system configuration.
        </p>
      </div>

      <ContractsCard />
      <TwilioAccountsCard />
    </div>
  );
}
