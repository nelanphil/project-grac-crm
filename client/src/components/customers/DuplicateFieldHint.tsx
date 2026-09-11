import Link from "next/link";
import { Loader2 } from "lucide-react";
import type { DuplicateFieldResult } from "@/lib/api";
import { formatCustomerRecordName } from "@/lib/formatName";

export default function DuplicateFieldHint({
  result,
  checking = false,
  hasValue = true,
}: {
  result?: DuplicateFieldResult | null;
  checking?: boolean;
  hasValue?: boolean;
}) {
  if (!hasValue) return null;

  if (checking && (!result || result.severity === "none")) {
    return (
      <p className="mt-1 inline-flex items-center gap-1 text-xs text-neutral-500">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking for duplicates…
      </p>
    );
  }

  if (!result || result.severity === "none" || result.matches.length === 0) {
    return null;
  }

  const blocking = result.severity === "blocking";

  return (
    <div
      role="status"
      className={`mt-1 rounded-md border px-2.5 py-1.5 text-xs ${
        blocking
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }`}
    >
      <p className="font-medium">
        {result.message ??
          (blocking
            ? "This value already exists on another customer."
            : "A contact with this value already exists.")}
      </p>
      <ul className="mt-1 space-y-0.5">
        {result.matches.slice(0, 3).map((match) => {
          const label =
            formatCustomerRecordName(match) ||
            [match.first, match.last].filter(Boolean).join(" ") ||
            "Existing customer";
          return (
            <li key={match._id}>
              <Link
                href={`/dashboard/customers/detail?id=${match._id}`}
                className="font-medium underline underline-offset-2"
              >
                {label}
              </Link>
              {match.legacyId ? ` · #${match.legacyId}` : ""}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function duplicateInputClass(
  base: string,
  result?: DuplicateFieldResult | null,
): string {
  if (!result || result.severity === "none") return base;
  if (result.severity === "blocking") {
    return `${base} border-red-300 focus:border-red-500`;
  }
  return `${base} border-amber-300 focus:border-amber-500`;
}
