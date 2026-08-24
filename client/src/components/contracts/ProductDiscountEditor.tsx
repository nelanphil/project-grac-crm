"use client";

import {
  DEFAULT_PRODUCT_DISCOUNTS,
  KindDiscount,
  ProductDiscounts,
  type DiscountMode,
} from "@/lib/productDiscounts";

const inputClass =
  "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-dark disabled:bg-neutral-50 disabled:text-neutral-400";

function sanitizeDecimal(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  const whole = cleaned.slice(0, firstDot);
  const fraction = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${fraction}`;
}

function KindRow({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: KindDiscount;
  onChange: (next: KindDiscount) => void;
  disabled?: boolean;
}) {
  const inputsDisabled = disabled || !value.enabled;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="inline-flex min-w-[9.5rem] items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...value, enabled: e.target.checked })
          }
        />
        {label}
      </label>
      <div className="flex flex-1 items-center gap-2">
        <div className="inline-flex rounded-md border border-neutral-300 p-0.5">
          {(["percent", "amount"] as DiscountMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              disabled={inputsDisabled}
              onClick={() => onChange({ ...value, mode })}
              className={`rounded px-2 py-1 text-xs font-medium ${
                value.mode === mode
                  ? "bg-brand-dark text-white"
                  : "text-neutral-600 hover:bg-neutral-50"
              } disabled:opacity-50`}
            >
              {mode === "percent" ? "%" : "$"}
            </button>
          ))}
        </div>
        {value.mode === "amount" ? (
          <div className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-neutral-500">
              $
            </span>
            <input
              inputMode="decimal"
              disabled={inputsDisabled}
              value={value.enabled ? String(value.value || "") : ""}
              placeholder="0.00"
              onChange={(e) =>
                onChange({
                  ...value,
                  value: Number(sanitizeDecimal(e.target.value)) || 0,
                })
              }
              className={`${inputClass} pl-7`}
            />
          </div>
        ) : (
          <div className="relative flex-1">
            <input
              inputMode="decimal"
              disabled={inputsDisabled}
              min={0}
              max={100}
              value={value.enabled ? String(value.value || "") : ""}
              placeholder="0"
              onChange={(e) => {
                const next = Number(sanitizeDecimal(e.target.value)) || 0;
                onChange({ ...value, value: Math.min(100, next) });
              }}
              className={`${inputClass} pr-8`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-sm text-neutral-500">
              %
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ProductDiscountEditor({
  value,
  onChange,
  disabled,
}: {
  value?: ProductDiscounts | null;
  onChange?: (next: ProductDiscounts) => void;
  disabled?: boolean;
}) {
  const discounts = value ?? DEFAULT_PRODUCT_DISCOUNTS;

  function patch(kind: "parts" | "labor", next: KindDiscount) {
    onChange?.({ ...discounts, [kind]: next });
  }

  return (
    <div className="space-y-3 rounded-lg border border-neutral-200 bg-neutral-50/60 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
        Parts & labor discounts
      </p>
      <KindRow
        label="Discount parts"
        value={discounts.parts}
        disabled={disabled}
        onChange={(next) => patch("parts", next)}
      />
      <KindRow
        label="Discount labor"
        value={discounts.labor}
        disabled={disabled}
        onChange={(next) => patch("labor", next)}
      />
    </div>
  );
}
