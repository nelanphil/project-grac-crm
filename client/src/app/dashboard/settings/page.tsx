"use client";

import { useState } from "react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import ProfileTab from "./ProfileTab";
import PasswordTab from "./PasswordTab";
import NotificationsTab from "./NotificationsTab";

type TabId = "profile" | "password" | "notifications";

interface Tab {
  id: TabId;
  label: string;
}

const TABS: Tab[] = [
  { id: "profile", label: "Profile" },
  { id: "password", label: "Password" },
  { id: "notifications", label: "Notifications" },
];

export default function SettingsPage() {
  return (
    <AuthGuard>
      <SettingsContent />
    </AuthGuard>
  );
}

function SettingsContent() {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  if (!user) return null;

  const renderTab = () => {
    switch (activeTab) {
      case "profile":
        return <ProfileTab />;
      case "password":
        return <PasswordTab />;
      case "notifications":
        return <NotificationsTab />;
    }
  };

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold text-brand-dark">Settings</h1>

      <div className="flex flex-col gap-8 md:flex-row">
        <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto md:w-48 md:flex-col md:overflow-x-visible">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`whitespace-nowrap rounded-lg px-4 py-2.5 text-left text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "bg-brand-dark text-white"
                  : "text-neutral-600 hover:bg-neutral-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">{renderTab()}</div>
      </div>
    </div>
  );
}
