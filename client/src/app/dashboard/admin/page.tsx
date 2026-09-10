"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import PaymentPlatformAppsCard from "@/components/admin/PaymentPlatformAppsCard";
import CloudinaryCredentialsCard from "@/components/admin/CloudinaryCredentialsCard";
import PublicAssetManagerCard from "@/components/admin/PublicAssetManagerCard";
import ContactFormEmailsCard from "@/components/admin/ContactFormEmailsCard";
import LegacyDatabaseSection from "@/components/admin/LegacyDatabaseSection";
import { useAuthStore } from "@/store/useAuthStore";

type TabId =
  | "payment-platforms"
  | "api-credentials"
  | "public-images"
  | "forms"
  | "database";

const TABS: { id: TabId; label: string }[] = [
  { id: "payment-platforms", label: "Payment platforms" },
  { id: "api-credentials", label: "API Credentials" },
  { id: "public-images", label: "Public Images" },
  { id: "forms", label: "Forms" },
  { id: "database", label: "Database" },
];

function parseTab(value: string | null): TabId {
  if (
    value === "payment-platforms" ||
    value === "api-credentials" ||
    value === "public-images" ||
    value === "forms" ||
    value === "database"
  ) {
    return value;
  }
  return "payment-platforms";
}

export default function AdminPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-bold text-brand-dark">
                Admin Panel
              </h1>
              <p className="mt-1 text-sm text-neutral-500">
                Manage platform credentials, public images, and form settings.
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 bg-white shadow-sm px-6 py-8 text-sm text-neutral-500">
              Loading…
            </div>
          </div>
        }
      >
        <AdminContent />
      </Suspense>
    </AuthGuard>
  );
}

function AdminContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === "super-admin";
  const activeTab = parseTab(searchParams.get("tab"));

  useEffect(() => {
    if (user && !isSuperAdmin) {
      router.replace("/dashboard");
    }
  }, [user, isSuperAdmin, router]);

  function setTab(id: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    const query = params.toString();
    router.replace(
      query ? `/dashboard/admin?${query}` : "/dashboard/admin",
      { scroll: false },
    );
  }

  if (!user || !isSuperAdmin) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Admin Panel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manage platform credentials, public images, and form settings.
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

      {activeTab === "payment-platforms" && (
        <PaymentPlatformAppsCard token={token} />
      )}
      {activeTab === "api-credentials" && (
        <CloudinaryCredentialsCard token={token} />
      )}
      {activeTab === "public-images" && (
        <PublicAssetManagerCard token={token} />
      )}
      {activeTab === "forms" && <ContactFormEmailsCard token={token} />}
      {activeTab === "database" && <LegacyDatabaseSection token={token} />}
    </div>
  );
}
