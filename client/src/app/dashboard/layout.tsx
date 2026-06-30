"use client";

import { usePathname } from "next/navigation";
import DashboardNav from "@/components/dashboard/DashboardNav";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showNav = !pathname.startsWith("/dashboard/settings");

  return (
    <div className="mx-auto flex max-w-screen-2xl gap-8 px-6 py-10">
      {showNav && <DashboardNav />}
      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
