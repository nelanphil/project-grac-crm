"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import { isDispatcherRole } from "@/lib/schedule";
import CalendarTab from "@/components/schedule/CalendarTab";
import TechniciansTab from "@/components/schedule/TechniciansTab";
import Segmented from "@/components/schedule/Segmented";

type TabId = "calendar" | "technicians";

function SchedulePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const dispatcher = isDispatcherRole(user);
  const tab: TabId =
    dispatcher && searchParams.get("tab") === "technicians"
      ? "technicians"
      : "calendar";

  function selectTab(next: TabId) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "technicians") params.set("tab", "technicians");
    else params.delete("tab");
    const qs = params.toString();
    router.replace(qs ? `/dashboard/schedule?${qs}` : "/dashboard/schedule", {
      scroll: false,
    });
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: "calendar", label: "Schedule Wizard" },
    ...(dispatcher ? [{ id: "technicians" as const, label: "Technicians" }] : []),
  ];

  return (
    <div className="flex flex-col gap-5 lg:h-[calc(100dvh-7.25rem)] lg:min-h-0 lg:-mb-20">
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
            onChange={selectTab}
            options={tabs}
          />
        )}
      </div>

      {tab === "calendar" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <CalendarTab />
        </div>
      )}
      {tab === "technicians" && dispatcher && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TechniciansTab />
        </div>
      )}
    </div>
  );
}

export default function SchedulePage() {
  return (
    <AuthGuard>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <SchedulePageInner />
      </Suspense>
    </AuthGuard>
  );
}
