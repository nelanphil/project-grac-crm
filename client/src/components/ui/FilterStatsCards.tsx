"use client";

import { LucideIcon } from "lucide-react";

export type KpiTone = "danger" | "info" | "success" | "warning" | "neutral";

export type FilterStatItem<T extends string> = {
  label: string;
  value: string;
  tone: KpiTone;
  filter: T;
};

const TONE_STYLES: Record<KpiTone, string> = {
  danger: "border-red-200 bg-red-50 text-red-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  neutral: "border-neutral-200 bg-white text-brand-dark",
};

const SELECTED_RING: Record<KpiTone, string> = {
  danger: "ring-2 ring-red-400 ring-offset-2",
  info: "ring-2 ring-sky-400 ring-offset-2",
  success: "ring-2 ring-emerald-400 ring-offset-2",
  warning: "ring-2 ring-amber-400 ring-offset-2",
  neutral: "ring-2 ring-brand-dark ring-offset-2",
};

function KpiCard<T extends string>({
  label,
  value,
  tone,
  filter,
  selected,
  onSelect,
}: {
  label: string;
  value: string;
  tone: KpiTone;
  filter: T;
  selected: boolean;
  onSelect: (filter: T) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(filter)}
      className={`block w-full min-w-0 rounded-2xl border px-3 py-3 text-left shadow-sm transition-shadow sm:px-4 sm:py-4 ${TONE_STYLES[tone]} ${
        selected ? SELECTED_RING[tone] : "hover:brightness-[0.98]"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80 sm:text-xs">
        {label}
      </p>
      <p className="mt-2 text-xl font-bold tracking-tight break-words sm:text-2xl">
        {value}
      </p>
    </button>
  );
}

export default function FilterStatsCards<T extends string>({
  title,
  icon: Icon,
  items,
  selected,
  onSelect,
  columns = 4,
}: {
  title: string;
  icon?: LucideIcon;
  items: FilterStatItem<T>[];
  selected: T;
  onSelect: (filter: T) => void;
  columns?: 3 | 4;
}) {
  const gridClass =
    columns === 3
      ? "grid w-full grid-cols-1 gap-3 sm:grid-cols-3"
      : "grid w-full grid-cols-2 gap-3 xl:grid-cols-4";

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        {Icon ? <Icon className="h-4 w-4 text-neutral-400" /> : null}
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {title}
        </h2>
      </div>
      <div className={gridClass}>
        {items.map((item) => (
          <KpiCard
            key={item.filter}
            label={item.label}
            value={item.value}
            tone={item.tone}
            filter={item.filter}
            selected={selected === item.filter}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
