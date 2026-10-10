import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  EXERCISE_WEEKDAYS,
  canonicalWeekday,
  exerciseDayLabel,
  fromTimeInputValue,
  toTimeInputValue,
} from "@/lib/exercise-schedule";

export function ExerciseDaySelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const canonical = canonicalWeekday(value);
  const trimmed = value.trim();
  const unknown = trimmed && !canonical ? trimmed : "";

  return (
    <select
      aria-label="Exercise Day"
      value={canonical ?? unknown}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    >
      <option value="">Select day</option>
      {EXERCISE_WEEKDAYS.map((day) => (
        <option key={day.value} value={day.value}>
          {day.label}
        </option>
      ))}
      {unknown ? <option value={unknown}>{unknown}</option> : null}
    </select>
  );
}

function exerciseDayOptions(value: string): {
  selected: string;
  label: string;
  options: Array<{ value: string; label: string }>;
} {
  const canonical = canonicalWeekday(value);
  const trimmed = value.trim();
  const unknown = trimmed && !canonical ? trimmed : "";
  const selected = canonical ?? unknown;
  const options = [
    { value: "", label: "Select day" },
    ...EXERCISE_WEEKDAYS.map((day) => ({ value: day.value, label: day.label })),
  ];
  if (unknown) options.push({ value: unknown, label: unknown });
  return {
    selected,
    label: selected ? exerciseDayLabel(selected) : "Select day",
    options,
  };
}

/** In-page day menu. The native select popup opens in the wrong place on the phone dashboard. */
export function ExerciseDayMenu({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const { selected, label, options } = exerciseDayOptions(value);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label="Exercise Day"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center justify-between gap-2 text-left ${className ?? ""}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
      </button>
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Exercise Day"
          className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-auto rounded border border-[var(--staff-border)] bg-[var(--staff-surface)] py-1 shadow-lg"
        >
          {options.map((option) => {
            const isSelected = option.value === selected;
            return (
              <li key={option.value || "none"} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`block w-full px-2 py-1.5 text-left text-sm text-[var(--staff-ink)] ${
                    isSelected
                      ? "bg-[var(--staff-cream)] font-medium"
                      : "hover:bg-[var(--staff-cream)]"
                  }`}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function ExerciseTimeInput({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <input
      type="time"
      aria-label="Time Set"
      value={toTimeInputValue(value)}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next ? fromTimeInputValue(next) : "");
      }}
      className={className}
    />
  );
}
