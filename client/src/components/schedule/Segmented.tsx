"use client";

export type SegmentedOption<T extends string> = {
  id: T;
  label: string;
  disabled?: boolean;
};

export default function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
}: {
  options: SegmentedOption<T>[];
  value: T | null;
  onChange: (id: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  const pad = size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex shrink-0 rounded-lg border border-neutral-200 bg-neutral-100 p-0.5"
    >
      {options.map((option) => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            disabled={option.disabled}
            onClick={() => onChange(option.id)}
            className={`whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-40 ${pad} ${
              active
                ? "bg-white text-brand-dark shadow-sm ring-1 ring-neutral-200"
                : "text-neutral-500 hover:text-brand-dark"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
