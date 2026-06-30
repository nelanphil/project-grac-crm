"use client";

import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";

const ROLE_LABELS: Record<string, string> = {
  "super-admin": "Super Admin",
  admin: "Administrator",
  owner: "Owner",
  manager: "Manager",
  tech: "Technician",
  agent: "Agent",
  customer: "Customer",
};

const ROLE_COLORS: Record<string, string> = {
  "super-admin": "bg-red-100 text-red-800",
  admin: "bg-purple-100 text-purple-800",
  owner: "bg-yellow-100 text-yellow-800",
  manager: "bg-blue-100 text-blue-800",
  tech: "bg-cyan-100 text-cyan-800",
  agent: "bg-green-100 text-green-800",
  customer: "bg-neutral-100 text-neutral-700",
};

export default function DashboardPage() {
  return (
    <AuthGuard>
      <DashboardContent />
    </AuthGuard>
  );
}

function DashboardContent() {
  const { user } = useAuthStore();

  if (!user) return null;

  return (
    <div>
      {/* Welcome card */}
      <div className="rounded-xl bg-white border border-neutral-200 p-6 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-neutral-500">Welcome back</p>
            <h2 className="mt-1 text-2xl font-bold text-brand-dark">
              {user.first_name} {user.last_name}
            </h2>
            <p className="mt-1 text-sm text-neutral-500">{user.email}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${ROLE_COLORS[user.role] ?? "bg-neutral-100 text-neutral-700"}`}
          >
            {ROLE_LABELS[user.role] ?? user.role}
          </span>
        </div>
      </div>

    </div>
  );
}
