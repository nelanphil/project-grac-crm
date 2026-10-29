"use client";

import { Frown, Meh, Smile, type LucideIcon } from "lucide-react";
import type { CustomerReputation } from "@/lib/api";

const OPTIONS: {
  value: CustomerReputation;
  label: string;
  Icon: LucideIcon;
  activeClass: string;
  idleClass: string;
}[] = [
  {
    value: "do_not_contact",
    label: "Do not contact",
    Icon: Frown,
    activeClass: "bg-red-50 text-red-600 ring-1 ring-inset ring-red-200",
    idleClass: "text-neutral-400 hover:bg-red-50 hover:text-red-600",
  },
  {
    value: "past_due",
    label: "Past due",
    Icon: Meh,
    activeClass: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200",
    idleClass: "text-neutral-400 hover:bg-amber-50 hover:text-amber-700",
  },
  {
    value: "good",
    label: "Good customer",
    Icon: Smile,
    activeClass: "bg-green-50 text-green-700 ring-1 ring-inset ring-green-200",
    idleClass: "text-neutral-400 hover:bg-green-50 hover:text-green-700",
  },
];

function optionFor(value: CustomerReputation | null | undefined) {
  return OPTIONS.find((option) => option.value === value) ?? null;
}

export default function CustomerReputationControl({
  value,
  readOnly = false,
  disabled = false,
  showLabel = false,
  onChange,
}: {
  value: CustomerReputation | null | undefined;
  readOnly?: boolean;
  disabled?: boolean;
  showLabel?: boolean;
  onChange?: (next: CustomerReputation | null) => void;
}) {
  const current = optionFor(value);

  if (readOnly) {
    if (!current) return null;
    const Icon = current.Icon;
    return (
      <span
        title={current.label}
        aria-label={current.label}
        className={`inline-flex items-center gap-1 rounded-md p-0.5 ${current.activeClass}`}
      >
        <Icon className="h-4 w-4" aria-hidden />
        {showLabel ? (
          <span className="pr-1 text-xs font-medium">{current.label}</span>
        ) : null}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        role="group"
        aria-label="Customer reputation"
        className="inline-flex items-center gap-1"
      >
        {OPTIONS.map((option) => {
          const active = value === option.value;
          const Icon = option.Icon;
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              title={option.label}
              aria-label={option.label}
              aria-pressed={active}
              onClick={() => onChange?.(active ? null : option.value)}
              className={`rounded-md p-1 disabled:cursor-not-allowed disabled:opacity-60 ${
                active ? option.activeClass : option.idleClass
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden />
            </button>
          );
        })}
      </span>
      {showLabel ? (
        <span className="text-sm text-neutral-500">
          {current?.label ?? "Unrated"}
        </span>
      ) : null}
    </span>
  );
}
