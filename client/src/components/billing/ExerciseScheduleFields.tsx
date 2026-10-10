import {
  EXERCISE_WEEKDAYS,
  canonicalWeekday,
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
