"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import { isDispatcherRole } from "@/lib/schedule";
import CalendarTab from "@/components/schedule/CalendarTab";
import TechniciansTab from "@/components/schedule/TechniciansTab";
import Segmented from "@/components/schedule/Segmented";

type TabId = "calendar" | "technicians";

function SchedulePageInner() {
  const user = useAuthStore((s) => s.user);
  const dispatcher = isDispatcherRole(user);

  const [tab, setTab] = useState<TabId>("calendar");

  const tabs: { id: TabId; label: string }[] = [
    { id: "calendar", label: "Schedule Wizard" },
    ...(dispatcher ? [{ id: "technicians" as const, label: "Technicians" }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <CalendarDays className="h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
          <h1 className="font-semibold text-brand-dark">Schedule</h1>
          <span className="hidden truncate text-neutral-400 sm:inline">
            {dispatcher
              ? "Dispatch work onto technician calendars."
              : "Your assigned work orders."}
          </span>
        </div>
        {tabs.length > 1 && (
          <Segmented<TabId>
            ariaLabel="Schedule section"
            value={tab}
            onChange={setTab}
            options={tabs}
          />
        )}
      </div>

      {tab === "calendar" && <CalendarTab />}
      {tab === "technicians" && dispatcher && <TechniciansTab />}
    </div>
  );
}

export default function SchedulePage() {
  return (
    <AuthGuard>
      <SchedulePageInner />
    </AuthGuard>
  );
}
