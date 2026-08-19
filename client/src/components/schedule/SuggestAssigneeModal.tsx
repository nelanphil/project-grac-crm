"use client";

import type { ScheduleSuggestion, WorkOrderListItem } from "@/lib/api";
import {
  formatAddressLine,
  formatLocalTime,
  minutesToLabel,
} from "@/lib/schedule";

function proximityLine(s: ScheduleSuggestion): string {
  if (!s.driveKnown) return "Drive time unavailable";
  const mins = minutesToLabel(s.driveMinutes);
  if (s.driveFrom === "previousJob") {
    return s.driveFromLabel
      ? `${mins} from last job (${s.driveFromLabel})`
      : `${mins} from last job`;
  }
  if (s.driveFrom === "home") {
    return `${mins} from home`;
  }
  return "Drive time unavailable";
}

function availabilityLine(s: ScheduleSuggestion): string {
  const parts: string[] = [];
  if (s.proposedStart) {
    parts.push(`Proposed ${formatLocalTime(new Date(s.proposedStart))}`);
  }
  if (s.remainingMinutes > 0) {
    parts.push(`${minutesToLabel(s.remainingMinutes)} remaining`);
  }
  if (s.reason && !s.fits) {
    parts.push(s.reason);
  }
  return parts.join(" · ");
}

export default function SuggestAssigneeModal({
  job,
  suggestions,
  saving,
  onAssign,
  onClose,
}: {
  job: WorkOrderListItem;
  suggestions: ScheduleSuggestion[];
  saving: boolean;
  onAssign: (userId: string, proposedStart: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-brand-dark">
          Suggested technicians
        </h3>
        <p className="mt-1 text-sm text-neutral-500">
          {job.customerName} · {formatAddressLine(job.address)}
        </p>
        <ul className="mt-4 space-y-2">
          {suggestions.map((s) => (
            <li
              key={s.userId}
              className="flex items-start justify-between gap-3 rounded-lg border border-neutral-200 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium text-brand-dark">
                  {s.first_name} {s.last_name}
                </div>
                <div className="mt-0.5 text-xs font-medium text-neutral-700">
                  {proximityLine(s)}
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  {availabilityLine(s)}
                </div>
              </div>
              <button
                type="button"
                disabled={!s.fits || !s.proposedStart || saving}
                onClick={() => onAssign(s.userId, s.proposedStart)}
                className="btn-primary shrink-0 px-3 py-1.5 text-xs disabled:opacity-40"
              >
                Assign
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
