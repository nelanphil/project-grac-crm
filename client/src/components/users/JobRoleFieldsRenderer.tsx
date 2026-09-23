"use client";

import type { JobRoleField } from "@/lib/api";

const inputClass =
  "mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange";

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return String(value);
}

export default function JobRoleFieldsRenderer({
  title,
  color,
  fields,
  values,
  onChange,
}: {
  title: string;
  color?: string;
  fields: JobRoleField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const ordered = [...fields].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return null;

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-brand-dark">
        <span
          className="inline-block h-2.5 w-2.5 rounded-full"
          style={{ backgroundColor: color || "#44403c" }}
        />
        {title}
      </p>
      {ordered.map((field) => {
        const value = values[field.key];
        const required = field.required;
        return (
          <div key={field.key}>
            {field.type !== "checkbox" ? (
              <label className="block text-sm font-medium text-brand-dark">
                {field.label}
                {required ? <span className="text-red-600"> *</span> : null}
              </label>
            ) : null}
            {field.type === "textarea" ? (
              <textarea
                required={required}
                value={stringValue(value)}
                onChange={(e) => onChange(field.key, e.target.value)}
                rows={3}
                className={inputClass}
              />
            ) : field.type === "select" ? (
              <select
                required={required}
                value={stringValue(value)}
                onChange={(e) => onChange(field.key, e.target.value)}
                className={inputClass}
              >
                <option value="">Select…</option>
                {field.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.type === "multiselect" ? (
              <div className="mt-2 space-y-1 rounded-md border border-neutral-200 bg-white p-2">
                {field.options.map((option) => {
                  const selected = Array.isArray(value)
                    ? value.map(String).includes(option)
                    : false;
                  return (
                    <label
                      key={option}
                      className="flex items-center gap-2 text-sm text-neutral-700"
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => {
                          const current = Array.isArray(value)
                            ? value.map(String)
                            : [];
                          onChange(
                            field.key,
                            selected
                              ? current.filter((item) => item !== option)
                              : [...current, option],
                          );
                        }}
                        className="rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                      />
                      {option}
                    </label>
                  );
                })}
              </div>
            ) : field.type === "checkbox" ? (
              <label className="flex items-start gap-2 text-sm text-neutral-700">
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                  className="mt-0.5 rounded border-neutral-300 text-brand-orange focus:ring-brand-orange"
                />
                <span>
                  <span className="font-medium">{field.label}</span>
                  {required ? <span className="text-red-600"> *</span> : null}
                </span>
              </label>
            ) : (
              <input
                required={required}
                type={
                  field.type === "number"
                    ? "number"
                    : field.type === "date"
                      ? "date"
                      : field.type === "email"
                        ? "email"
                        : field.type === "phone"
                          ? "tel"
                          : "text"
                }
                value={stringValue(value)}
                onChange={(e) =>
                  onChange(
                    field.key,
                    field.type === "number" && e.target.value !== ""
                      ? Number(e.target.value)
                      : e.target.value,
                  )
                }
                className={inputClass}
              />
            )}
            {field.helpText ? (
              <p className="mt-1 text-xs text-neutral-500">{field.helpText}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
