"use client";

import { usePathname } from "next/navigation";
import { DashboardHistoryTracker } from "@/components/dashboard/DashboardBackLink";
import { isJobTerminalPopoutPath } from "@/utils/jobTerminalWindow";
import StaffIconSidebar from "./StaffIconSidebar";
import StaffTopBar from "./StaffTopBar";

export default function StaffDashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isTerminalPopout = isJobTerminalPopoutPath(pathname);

  if (isTerminalPopout) {
    return (
      <div className="h-dvh w-full overflow-hidden bg-neutral-950">
        {children}
      </div>
    );
  }

  return (
    <div className="staff-dashboard flex w-full min-h-[calc(100vh-0px)] max-w-full overflow-x-clip bg-[var(--staff-canvas)] print:bg-white print:min-h-0">
      <DashboardHistoryTracker />
      <div className="hidden lg:block print:hidden">
        <StaffIconSidebar />
      </div>
      <div className="flex min-w-0 w-full flex-1 flex-col">
        <div className="print:hidden">
          <StaffTopBar />
        </div>
        <div className="w-full min-w-0 flex-1 px-3 pb-24 pt-4 sm:px-6 sm:pb-20 sm:pt-6 lg:px-8 print:px-0 print:py-0">
          {children}
        </div>
      </div>
    </div>
  );
}
