"use client";

import type { UserHomeLocation, UserWeeklyHours } from "@/lib/api";
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
} from "@/lib/schedule";

export default function StaffWorkHoursForm({
  weeklyHours,
  home,
  onPatchWeekly,
  onChangeHome,
  onBlurHome,
  homeValidating,
  homeMsg,
}: {
  weeklyHours: UserWeeklyHours;
  home: UserHomeLocation;
  onPatchWeekly: (
    day: keyof UserWeeklyHours,
    patch: Partial<UserWeeklyHours[keyof UserWeeklyHours]>,
  ) => void;
  onChangeHome: (patch: Partial<UserHomeLocation>) => void;
  onBlurHome: () => void;
  homeValidating: boolean;
  homeMsg: string | null;
}) {
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-neutral-50 text-neutral-500">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">Day</th>
              <th className="px-2 py-1.5 text-left font-medium">On</th>
              <th className="px-2 py-1.5 text-left font-medium">Start</th>
              <th className="px-2 py-1.5 text-left font-medium">End</th>
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_KEYS.map((key) => {
              const day = weeklyHours[key];
              return (
                <tr key={key} className="border-t border-neutral-100">
                  <td className="px-2 py-1.5 text-neutral-700">
                    {WEEKDAY_LABELS[key]}
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={day.enabled}
                      onChange={(e) =>
                        onPatchWeekly(key, { enabled: e.target.checked })
                      }
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="time"
                      value={day.start}
                      disabled={!day.enabled}
                      onChange={(e) =>
                        onPatchWeekly(key, { start: e.target.value })
                      }
                      className="rounded border border-neutral-200 px-1 py-0.5 disabled:opacity-40"
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="time"
                      value={day.end}
                      disabled={!day.enabled}
                      onChange={(e) =>
                        onPatchWeekly(key, { end: e.target.value })
                      }
                      className="rounded border border-neutral-200 px-1 py-0.5 disabled:opacity-40"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-neutral-600">Home location</p>
        <input
          value={home.address}
          onChange={(e) => onChangeHome({ address: e.target.value })}
          onBlur={onBlurHome}
          placeholder="Street address"
          className="block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
        />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <input
            value={home.city}
            onChange={(e) => onChangeHome({ city: e.target.value })}
            onBlur={onBlurHome}
            placeholder="City"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
          />
          <input
            value={home.state}
            onChange={(e) => onChangeHome({ state: e.target.value })}
            onBlur={onBlurHome}
            placeholder="State"
            className="rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
          />
          <input
            value={home.zip}
            onChange={(e) => onChangeHome({ zip: e.target.value })}
            onBlur={onBlurHome}
            placeholder="ZIP"
            className="col-span-2 rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange sm:col-span-1"
          />
        </div>
        {homeValidating && (
          <p className="text-xs text-neutral-400">Validating address…</p>
        )}
        {homeMsg && <p className="text-xs text-neutral-500">{homeMsg}</p>}
      </div>
    </div>
  );
}
