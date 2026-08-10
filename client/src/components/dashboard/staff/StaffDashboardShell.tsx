"use client";

import StaffIconSidebar from "./StaffIconSidebar";
import StaffTopBar from "./StaffTopBar";

export default function StaffDashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="staff-dashboard flex w-full min-h-[calc(100vh-0px)] max-w-full overflow-x-clip bg-[var(--staff-canvas)] print:bg-white print:min-h-0">
      <div className="hidden md:block print:hidden">
        <StaffIconSidebar />
      </div>
      <div className="flex min-w-0 w-full flex-1 flex-col">
        <div className="print:hidden">
          <StaffTopBar />
        </div>
        <div className="w-full min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8 print:px-0 print:py-0">
          {children}
        </div>
      </div>
    </div>
  );
}
