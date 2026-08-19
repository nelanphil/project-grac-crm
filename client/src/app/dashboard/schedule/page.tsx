"use client";

import { useState } from "react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import { formatLocalDate, isDispatcherRole } from "@/lib/schedule";
import JobsQueue from "@/components/schedule/JobsQueue";
import CalendarTab from "@/components/schedule/CalendarTab";
import TechniciansTab from "@/components/schedule/TechniciansTab";

type TabId = "jobs" | "calendar" | "technicians";

function SchedulePageInner() {
  const user = useAuthStore((s) => s.user);
  const dispatcher = isDispatcherRole(user?.role);
  const today = formatLocalDate(new Date());

  const [tab, setTab] = useState<TabId>("jobs");
  const [calendarDate, setCalendarDate] = useState(today);

  const tabs: { id: TabId; label: string }[] = [
    { id: "jobs", label: "Jobs" },
    { id: "calendar", label: "Calendar" },
    ...(dispatcher ? [{ id: "technicians" as const, label: "Technicians" }] : []),
  ];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-brand-dark">Schedule</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {dispatcher
            ? "Review the job queue, dispatch onto technician calendars, and manage who appears on the board."
            : "Your assigned work orders. Open the calendar to see your day."}
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-lg border border-neutral-200 bg-white p-0.5 w-fit">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ${
              tab === item.id
                ? "bg-brand-orange text-white"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "jobs" && (
        <JobsQueue
          onOpenCalendar={(date) => {
            setCalendarDate(date);
            setTab("calendar");
          }}
        />
      )}
      {tab === "calendar" && <CalendarTab initialDate={calendarDate} />}
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
