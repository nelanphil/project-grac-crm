"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import DashboardNav from "@/components/dashboard/DashboardNav";
import StaffDashboardShell from "@/components/dashboard/staff/StaffDashboardShell";
import { isJobTerminalPopoutPath } from "@/utils/jobTerminalWindow";
import { authGetMe } from "@/lib/api";
import { isStaffRole } from "@/lib/dashboard-role";
import { useAuthStore } from "@/store/useAuthStore";
import { useHasHydrated } from "@/store/useHasHydrated";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const hydrated = useHasHydrated();
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const login = useAuthStore((s) => s.login);
  const [syncedToken, setSyncedToken] = useState<string | null>(null);
  const isTerminalPopout = isJobTerminalPopoutPath(pathname);
  const synced = !token || syncedToken === token;

  useEffect(() => {
    if (!hydrated || !token) return;
    let cancelled = false;
    authGetMe(token)
      .then(({ user: fresh }) => {
        if (!cancelled) login(token, fresh);
      })
      .catch(() => {
        // Keep the stored session if the refresh fails.
      })
      .finally(() => {
        if (!cancelled) setSyncedToken(token);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, token, login]);

  if (!hydrated || !synced) {
    if (isTerminalPopout) {
      return (
        <div className="h-dvh w-full bg-neutral-950" aria-busy="true">
          {children}
        </div>
      );
    }
    return (
      <div
        className="min-h-[50vh] bg-[var(--staff-canvas)] px-4 py-6 sm:px-6"
        aria-busy="true"
        aria-label="Loading dashboard"
      >
        {children}
      </div>
    );
  }

  if (isStaffRole(user)) {
    return <StaffDashboardShell>{children}</StaffDashboardShell>;
  }

  const showNav = !pathname.startsWith("/dashboard/settings");
  const isWideLayout = !pathname.startsWith("/dashboard/settings");

  return (
    <div
      className={`mx-auto flex gap-8 py-6 md:py-10 print:block print:max-w-none print:gap-0 print:px-0 print:py-0 uppercase ${
        isWideLayout
          ? "w-full max-w-none px-4 sm:px-6 lg:px-10"
          : "max-w-screen-2xl px-4 sm:px-6"
      }`}
    >
      {showNav && <DashboardNav />}
      <main className="min-w-0 flex-1 print:w-full">{children}</main>
    </div>
  );
}
