import { AlertTriangle } from "lucide-react";
import type { CustomerPastDue } from "@/lib/api";

export function formatPastDueMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export function pastDueLabel(pastDue: CustomerPastDue): string {
  const amount = formatPastDueMoney(pastDue.totalCents);
  return pastDue.count > 1
    ? `Past due · ${amount} (${pastDue.count})`
    : `Past due · ${amount}`;
}

export default function PastDueBadge({
  pastDue,
  compact = false,
}: {
  pastDue?: CustomerPastDue | null;
  compact?: boolean;
}) {
  if (!pastDue || pastDue.count <= 0 || pastDue.totalCents <= 0) return null;
  const label = pastDueLabel(pastDue);

  if (compact) {
    return (
      <span
        title={label}
        className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-red-700 ring-1 ring-inset ring-red-200"
      >
        <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
        Past due
      </span>
    );
  }

  return (
    <span
      title={label}
      className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-inset ring-red-200"
    >
      <AlertTriangle className="h-3 w-3" aria-hidden />
      {label}
    </span>
  );
}
