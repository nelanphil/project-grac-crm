"use client";

import { usePathname } from "next/navigation";
import DashboardNav from "@/components/dashboard/DashboardNav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNav = !pathname.startsWith("/dashboard/settings");
  const isCustomersSection =
    pathname.startsWith("/dashboard/customers") ||
    pathname.startsWith("/dashboard/contracts");

  return (
    <div
      className={`mx-auto flex gap-8 py-10 ${
        isCustomersSection
          ? "w-full max-w-none px-4 sm:px-6 lg:px-10"
          : "max-w-screen-2xl px-6"
      }`}
    >
      {showNav && <DashboardNav />}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
