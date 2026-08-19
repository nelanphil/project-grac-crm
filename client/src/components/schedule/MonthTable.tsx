"use client";

import { useMemo, useState } from "react";
import type { WorkOrderListItem } from "@/lib/api";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import {
  DEFAULT_ESTIMATED_MINUTES,
  formatAddressLine,
  formatLocalDate,
  formatLocalTime,
  minutesToLabel,
} from "@/lib/schedule";

type SortKey = "date" | "customer" | "tech" | "duration";

export default function MonthTable({
  jobs,
  onJobClick,
}: {
  jobs: WorkOrderListItem[];
  onJobClick: (job: WorkOrderListItem) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  function toggle(key: SortKey) {
    if (sortKey === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setDir("asc");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...jobs];
    copy.sort((a, b) => {
      const aDate = a.scheduledStart || a.date || "";
      const bDate = b.scheduledStart || b.date || "";
      let cmp = 0;
      if (sortKey === "date") cmp = String(aDate).localeCompare(String(bDate));
      if (sortKey === "customer")
        cmp = (a.customerName || "").localeCompare(b.customerName || "");
      if (sortKey === "tech")
        cmp = (a.assignee
          ? `${a.assignee.first_name} ${a.assignee.last_name}`
          : a.tech
        ).localeCompare(
          b.assignee
            ? `${b.assignee.first_name} ${b.assignee.last_name}`
            : b.tech,
        );
      if (sortKey === "duration")
        cmp =
          (a.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES) -
          (b.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES);
      return dir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [jobs, sortKey, dir]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (dir === "asc" ? " ↑" : " ↓") : "";

  return (
    <ResponsiveDataView
      isEmpty={sorted.length === 0}
      empty={
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white py-16 text-center text-sm text-neutral-500">
          No work orders in this month.
        </div>
      }
      mobile={
        <>
          {sorted.map((job) => (
            <MobileDataCard
              key={job._id}
              title={job.customerName || "Customer"}
              subtitle={formatAddressLine(job.address)}
              onClick={() => onJobClick(job)}
              fields={
                <>
                  <DataField
                    label="When"
                    value={
                      job.scheduledStart
                        ? `${formatLocalDate(new Date(job.scheduledStart))} ${formatLocalTime(new Date(job.scheduledStart))}`
                        : job.date
                          ? String(job.date).slice(0, 10)
                          : "Unscheduled"
                    }
                  />
                  <DataField
                    label="Tech"
                    value={
                      job.assignee
                        ? `${job.assignee.first_name} ${job.assignee.last_name}`
                        : job.tech || "—"
                    }
                  />
                  <DataField
                    label="Duration"
                    value={minutesToLabel(
                      job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
                    )}
                  />
                </>
              }
            />
          ))}
        </>
      }
      desktop={
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-4 py-3 text-left">
                  <button type="button" onClick={() => toggle("date")}>
                    Date / time{arrow("date")}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button type="button" onClick={() => toggle("customer")}>
                    Customer{arrow("customer")}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">Address</th>
                <th className="px-4 py-3 text-left">
                  <button type="button" onClick={() => toggle("tech")}>
                    Technician{arrow("tech")}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">
                  <button type="button" onClick={() => toggle("duration")}>
                    Duration{arrow("duration")}
                  </button>
                </th>
                <th className="px-4 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {sorted.map((job) => (
                <tr
                  key={job._id}
                  className="cursor-pointer hover:bg-neutral-50"
                  onClick={() => onJobClick(job)}
                >
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                    {job.scheduledStart
                      ? `${formatLocalDate(new Date(job.scheduledStart))} ${formatLocalTime(new Date(job.scheduledStart))}`
                      : job.date
                        ? String(job.date).slice(0, 10)
                        : "Unscheduled"}
                  </td>
                  <td className="px-4 py-3 font-medium text-brand-dark">
                    {job.customerName || "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {formatAddressLine(job.address)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-neutral-700">
                    {job.assignee
                      ? `${job.assignee.first_name} ${job.assignee.last_name}`
                      : job.tech || "—"}
                  </td>
                  <td className="px-4 py-3 text-neutral-600">
                    {minutesToLabel(
                      job.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES,
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {job.completed ? (
                      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                        Completed
                      </span>
                    ) : job.scheduledStart ? (
                      <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-brand-orange">
                        Scheduled
                      </span>
                    ) : (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">
                        Unscheduled
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      }
    />
  );
}
