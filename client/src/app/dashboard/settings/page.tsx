"use client";

import { useState } from "react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import ProfileTab from "./ProfileTab";
import PasswordTab from "./PasswordTab";
import NotificationsTab from "./NotificationsTab";
import UsersTab from "./UsersTab";
import RolesTab from "./RolesTab";

type TabId = "profile" | "password" | "notifications" | "users" | "roles";

interface Tab {
  id: TabId;
  label: string;
  roles?: string[];
}

const TABS: Tab[] = [
  { id: "profile", label: "Profile" },
  { id: "password", label: "Password" },
  { id: "notifications", label: "Notifications" },
  { id: "users", label: "Users", roles: ["super-admin", "admin", "owner"] },
  { id: "roles", label: "Roles & Permissions", roles: ["super-admin"] },
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

  const visibleTabs = TABS.filter(
    (tab) => !tab.roles || tab.roles.includes(user.role)
  );

  const renderTab = () => {
    switch (activeTab) {
      case "profile":       return <ProfileTab />;
      case "password":      return <PasswordTab />;
      case "notifications": return <NotificationsTab />;
      case "users":         return <UsersTab />;
      case "roles":         return <RolesTab />;
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-brand-dark mb-8">Settings</h1>

      <div className="flex flex-col gap-8 md:flex-row">
        {/* Sidebar tab list */}
        <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto md:w-48 md:flex-col md:overflow-x-visible">
          {visibleTabs.map((tab) => (
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

        {/* Tab content panel */}
        <div className="flex-1 min-w-0">
          {renderTab()}
        </div>
      </div>
    </div>
  );
}
