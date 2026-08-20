"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import TwilioAccountsCard from "@/components/control-panel/TwilioAccountsCard";
import EmailAccountsCard from "@/components/control-panel/EmailAccountsCard";
import GoogleCredentialsCard from "@/components/control-panel/GoogleCredentialsCard";
import PaymentProvidersCard from "@/components/control-panel/PaymentProvidersCard";
import { useAuthStore } from "@/store/useAuthStore";

const ADMIN_ROLES = ["admin", "super-admin", "owner"];

type TabId = "payments" | "communications" | "api-services";

const TABS: { id: TabId; label: string }[] = [
  { id: "payments", label: "Payments" },
  { id: "communications", label: "Communications" },
  { id: "api-services", label: "API Services" },
];

function parseTab(value: string | null, forcePayments: boolean): TabId {
  if (forcePayments) return "payments";
  if (
    value === "payments" ||
    value === "communications" ||
    value === "api-services"
  ) {
    return value;
  }
  return "payments";
}

export default function ControlPanelPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-brand-dark">
                Control Panel
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                Manage integrations and system configuration.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
              Loading…
            </div>
          </div>
        }
      >
        <ControlPanelContent />
      </Suspense>
    </AuthGuard>
  );
}

function ControlPanelContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);

  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;
  const activeTab = parseTab(
    searchParams.get("tab"),
    Boolean(searchParams.get("square_oauth")),
  );

  useEffect(() => {
    if (user && !isAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isAdmin, router]);

  function setTab(id: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    const query = params.toString();
    router.replace(
      query ? `/dashboard/control-panel?${query}` : "/dashboard/control-panel",
      { scroll: false },
    );
  }

  if (!user || !isAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Control Panel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manage integrations and system configuration.
        </p>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-neutral-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`border-b-2 px-1 pb-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "border-brand-orange text-brand-dark"
                : "border-transparent text-neutral-500 hover:text-brand-dark"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "payments" && (
        <Suspense
          fallback={
            <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
              Loading payment providers…
            </div>
          }
        >
          <PaymentProvidersCard />
        </Suspense>
      )}

      {activeTab === "communications" && (
        <div className="space-y-6">
          <EmailAccountsCard />
          <TwilioAccountsCard />
        </div>
      )}

      {activeTab === "api-services" && <GoogleCredentialsCard />}
    </div>
  );
}
