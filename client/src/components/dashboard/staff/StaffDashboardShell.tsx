"use client";

import StaffIconSidebar from "./StaffIconSidebar";
import StaffTopBar from "./StaffTopBar";

export default function StaffDashboardShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="staff-dashboard flex min-h-[calc(100vh-0px)] bg-[var(--staff-canvas)]">
      <div className="hidden md:block">
        <StaffIconSidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <StaffTopBar />
        <div className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</div>
      </div>
    </div>
  );
}
