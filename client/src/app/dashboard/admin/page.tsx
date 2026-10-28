"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import PaymentPlatformAppsCard from "@/components/admin/PaymentPlatformAppsCard";
import CloudinaryCredentialsCard from "@/components/admin/CloudinaryCredentialsCard";
import QuoCredentialsCard from "@/components/admin/QuoCredentialsCard";
import XaiCredentialsCard from "@/components/admin/XaiCredentialsCard";
import PublicAssetManagerCard from "@/components/admin/PublicAssetManagerCard";
import ContactFormEmailsCard from "@/components/admin/ContactFormEmailsCard";
import TwilioResponsesCard from "@/components/admin/TwilioResponsesCard";
import AutomatedMessagesCard from "@/components/admin/AutomatedMessagesCard";
import DatabaseSection from "@/components/admin/DatabaseSection";
import CrashReportsTab from "@/components/admin/CrashReportsTab";
import NameReportsTab from "@/components/admin/NameReportsTab";
import MobileTabBar from "@/components/ui/MobileTabBar";
import { useAuthStore } from "@/store/useAuthStore";

type TabId =
  | "payment-platforms"
  | "api-credentials"
  | "public-images"
  | "forms"
  | "twilio-responses"
  | "automated-messages"
  | "database"
  | "crash-reports"
  | "reports";

const TABS: { id: TabId; label: string }[] = [
  { id: "payment-platforms", label: "Payment platforms" },
  { id: "api-credentials", label: "API Credentials" },
  { id: "public-images", label: "Public Images" },
  { id: "forms", label: "Forms" },
  { id: "twilio-responses", label: "Twilio Responses" },
  { id: "automated-messages", label: "Automated messages" },
  { id: "database", label: "Database" },
  { id: "crash-reports", label: "Crash reports" },
  { id: "reports", label: "Reports" },
];

function parseTab(value: string | null): TabId {
  if (
    value === "payment-platforms" ||
    value === "api-credentials" ||
    value === "public-images" ||
    value === "forms" ||
    value === "twilio-responses" ||
    value === "automated-messages" ||
    value === "database" ||
    value === "crash-reports" ||
    value === "reports"
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
                Manage platform credentials, public images, form settings, Twilio responses, automated messages, crash reports, and name reports.
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
  const activeTab = parseTab(searchParams.get("tab"));

  function setTab(id: TabId) {
    const params = new URLSearchParams();
    params.set("tab", id);
    if (id === "database") {
      const section = searchParams.get("section");
      const target = searchParams.get("target");
      const collection = searchParams.get("collection");
      if (section) params.set("section", section);
      if (target) params.set("target", target);
      if (collection) params.set("collection", collection);
    }
    router.replace(`/dashboard/admin?${params.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Admin Panel</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Manage platform credentials, public images, form settings, Twilio responses, automated messages, crash reports, and name reports.
        </p>
      </div>

      <MobileTabBar className="border-b border-neutral-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setTab(tab.id)}
            className={`shrink-0 border-b-2 px-2 pb-3 text-sm font-medium transition-colors md:px-1 ${
              activeTab === tab.id
                ? "border-brand-orange text-brand-dark"
                : "border-transparent text-neutral-500 hover:text-brand-dark"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </MobileTabBar>

      {activeTab === "payment-platforms" && (
        <PaymentPlatformAppsCard token={token} />
      )}
      {activeTab === "api-credentials" && (
        <div className="space-y-6">
          <CloudinaryCredentialsCard token={token} />
          <QuoCredentialsCard token={token} />
          <XaiCredentialsCard token={token} />
        </div>
      )}
      {activeTab === "public-images" && (
        <PublicAssetManagerCard token={token} />
      )}
      {activeTab === "forms" && <ContactFormEmailsCard token={token} />}
      {activeTab === "twilio-responses" && (
        <TwilioResponsesCard token={token} />
      )}
      {activeTab === "automated-messages" && (
        <AutomatedMessagesCard token={token} />
      )}
      {activeTab === "database" && <DatabaseSection token={token} />}
      {activeTab === "crash-reports" && <CrashReportsTab token={token} />}
      {activeTab === "reports" && <NameReportsTab token={token} />}
    </div>
  );
}
