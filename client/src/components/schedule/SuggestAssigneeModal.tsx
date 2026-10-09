"use client";

import { useState } from "react";
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

function overrideWarning(s: ScheduleSuggestion): string {
  if (!s.available) {
    return "Not scheduled to work this day. Continuing will override their schedule.";
  }
  if (s.reason === "Not enough remaining capacity") {
    return "Their day is full. Continuing will override their schedule.";
  }
  return "Proposed time is outside their working hours. Continuing will override their schedule.";
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
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-lg font-semibold text-brand-dark">
          Suggested technicians
        </h3>
        <p className="mt-1 text-sm text-neutral-500">
          {[
            job.customerName,
            formatAddressLine(job.address),
            job.workOrderType?.label,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <ul className="mt-4 space-y-2">
          {suggestions.map((s) => {
            const needsOverride = !s.available || !s.fits;
            const confirming = confirmId === s.userId;
            return (
              <li
                key={s.userId}
                className="rounded-lg border border-neutral-200 px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-brand-dark">
                      {s.first_name} {s.last_name}
                    </div>
                    {!s.available ? (
                      <span className="mt-0.5 inline-flex rounded-full bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                        Off this day
                      </span>
                    ) : null}
                    {s.inTerritory ? (
                      <div className="mt-0.5 text-xs font-medium text-emerald-700">
                        In territory
                      </div>
                    ) : null}
                    <div className="mt-0.5 text-xs font-medium text-neutral-700">
                      {proximityLine(s)}
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500">
                      {availabilityLine(s)}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!s.proposedStart || saving}
                    onClick={() => {
                      if (needsOverride) {
                        setConfirmId(s.userId);
                        return;
                      }
                      onAssign(s.userId, s.proposedStart);
                    }}
                    className="btn-primary shrink-0 px-3 py-1.5 text-xs disabled:opacity-40"
                  >
                    Assign
                  </button>
                </div>
                {confirming ? (
                  <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                    <p>{overrideWarning(s)}</p>
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="rounded-md px-2 py-1 text-xs text-amber-900 hover:bg-amber-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={saving || !s.proposedStart}
                        onClick={() => onAssign(s.userId, s.proposedStart)}
                        className="btn-primary px-2.5 py-1 text-xs disabled:opacity-40"
                      >
                        Assign anyway
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
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
