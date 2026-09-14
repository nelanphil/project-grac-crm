"use client";

import {
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import type { ManufacturerItem, ProductKind, ProductWritePayload } from "@/lib/api";

export type ProductFormState = {
  productCode: string;
  productNumber: string;
  name: string;
  manufacturer: string;
  kind: ProductKind;
  listPrice: string;
  cost: string;
  strikeThroughPrice: string;
  active: boolean;
  notes: string;
};

export const EMPTY_PRODUCT_FORM: ProductFormState = {
  productCode: "",
  productNumber: "",
  name: "",
  manufacturer: "",
  kind: "part",
  listPrice: "0.00",
  cost: "0.00",
  strikeThroughPrice: "",
  active: true,
  notes: "",
};

const ADD_MANUFACTURER = "__add__";
const DEFAULT_MANUFACTURER_NAME = "GENERAC";

export function defaultManufacturerId(list: ManufacturerItem[]): string {
  const match = list.find(
    (m) => m.name.toUpperCase() === DEFAULT_MANUFACTURER_NAME,
  );
  return match?._id ?? list[0]?._id ?? "";
}

export function normalizeProductCode(productCode: string): string {
  return productCode.replace(/\s+/g, "").toUpperCase();
}

export function uppercaseText(value: string): string {
  return value.toUpperCase();
}

export function buildProductAltCode(productCode: string): string {
  const code = normalizeProductCode(productCode);
  if (!code) return "";
  if (code.startsWith("GMOF")) return code;
  return `GMOF${code}`;
}

export function moneyString(amount: number): string {
  return Number.isFinite(amount) ? amount.toFixed(2) : "";
}

export function isProductFormComplete(
  form: ProductFormState,
  addingManufacturer: boolean,
): boolean {
  return (
    Boolean(form.productCode) &&
    Boolean(form.name.trim()) &&
    Boolean(form.manufacturer) &&
    !addingManufacturer &&
    form.listPrice.trim() !== "" &&
    !Number.isNaN(Number(form.listPrice))
  );
}

export function toProductWritePayload(form: ProductFormState): ProductWritePayload {
  return {
    productCode: normalizeProductCode(form.productCode),
    productNumber: uppercaseText(form.productNumber.trim()),
    name: uppercaseText(form.name.trim()),
    manufacturer: form.manufacturer || undefined,
    kind: form.kind,
    listPrice: Number(form.listPrice) || 0,
    cost: Number(form.cost) || 0,
    strikeThroughPrice: Number(form.strikeThroughPrice) || 0,
    active: form.active,
    notes: uppercaseText(form.notes.trim()),
  };
}

function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  const whole = cleaned.slice(0, firstDot);
  const fraction = cleaned.slice(firstDot + 1).replace(/\./g, "").slice(0, 2);
  return `${whole}.${fraction}`;
}

const inputClass =
  "w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

const textInputClass = `${inputClass} uppercase`;

function applyUppercaseInput(
  value: string,
  onChange: (value: string) => void,
  transform: (raw: string) => string,
) {
  onChange(transform(value));
}

function UppercaseInput({
  value,
  onChange,
  transform = uppercaseText,
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  transform?: (raw: string) => string;
}) {
  return (
    <input
      {...props}
      value={value}
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      onChange={(e) => applyUppercaseInput(e.target.value, onChange, transform)}
      onBlur={(e) => {
        applyUppercaseInput(e.target.value, onChange, transform);
        props.onBlur?.(e);
      }}
      className={`${textInputClass} ${className ?? ""}`.trim()}
    />
  );
}

function UppercaseTextarea({
  value,
  onChange,
  className,
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <textarea
      {...props}
      value={value}
      autoCapitalize="characters"
      autoCorrect="off"
      spellCheck={false}
      onChange={(e) => applyUppercaseInput(e.target.value, onChange, uppercaseText)}
      onBlur={(e) => {
        applyUppercaseInput(e.target.value, onChange, uppercaseText);
        props.onBlur?.(e);
      }}
      className={`${textInputClass} ${className ?? ""}`.trim()}
    />
  );
}

function FieldLabel({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <span className="mb-1 block text-neutral-600">
      {children}{" "}
      {required ? (
        <span className="font-medium text-red-600">*</span>
      ) : (
        <span className="font-normal text-neutral-400">(optional)</span>
      )}
    </span>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-sm text-neutral-500">
        $
      </span>
      <input
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(sanitizeMoneyInput(e.target.value))}
        onBlur={() => {
          if (value.trim() === "") return;
          const n = Number(value);
          if (!Number.isNaN(n)) onChange(n.toFixed(2));
        }}
        className={`${inputClass} pl-7`}
      />
    </div>
  );
}

export default function ProductEditorFields({
  form,
  onChange,
  manufacturers,
  addingManufacturer,
  newManufacturerName,
  addingManufacturerSaving,
  onStartAddManufacturer,
  onCancelAddManufacturer,
  onNewManufacturerNameChange,
  onAddManufacturer,
}: {
  form: ProductFormState;
  onChange: (updates: Partial<ProductFormState>) => void;
  manufacturers: ManufacturerItem[];
  addingManufacturer: boolean;
  newManufacturerName: string;
  addingManufacturerSaving: boolean;
  onStartAddManufacturer: () => void;
  onCancelAddManufacturer: () => void;
  onNewManufacturerNameChange: (value: string) => void;
  onAddManufacturer: () => void;
}) {
  const previewAltCode = buildProductAltCode(form.productCode);

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">
        <FieldLabel required>Product code</FieldLabel>
        <UppercaseInput
          value={form.productCode}
          transform={normalizeProductCode}
          onChange={(productCode) => onChange({ productCode })}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Product number</FieldLabel>
        <UppercaseInput
          value={form.productNumber}
          onChange={(productNumber) => onChange({ productNumber })}
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <FieldLabel>Product alt code</FieldLabel>
        <UppercaseInput
          value={previewAltCode}
          readOnly
          className="bg-neutral-50 text-neutral-500"
          onChange={() => undefined}
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <FieldLabel required>Name</FieldLabel>
        <UppercaseInput
          value={form.name}
          onChange={(name) => onChange({ name })}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel required>Type</FieldLabel>
        <select
          value={form.kind}
          onChange={(e) => onChange({ kind: e.target.value as ProductKind })}
          className={inputClass}
        >
          <option value="part">Part</option>
          <option value="labor">Labor</option>
        </select>
      </label>
      <div className="block text-sm">
        <FieldLabel required>Manufacturer</FieldLabel>
        <select
          value={addingManufacturer ? ADD_MANUFACTURER : form.manufacturer}
          onChange={(e) => {
            const v = e.target.value;
            if (v === ADD_MANUFACTURER) {
              onStartAddManufacturer();
              return;
            }
            onCancelAddManufacturer();
            onChange({ manufacturer: v });
          }}
          className={textInputClass}
        >
          {manufacturers.map((m) => (
            <option key={m._id} value={m._id}>
              {uppercaseText(m.name)}
            </option>
          ))}
          <option value={ADD_MANUFACTURER}>Add manufacturer…</option>
        </select>
        {addingManufacturer ? (
          <div className="mt-2 flex gap-2">
            <UppercaseInput
              value={newManufacturerName}
              placeholder="MANUFACTURER NAME"
              autoFocus
              onChange={onNewManufacturerNameChange}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void onAddManufacturer();
                }
              }}
            />
            <button
              type="button"
              disabled={addingManufacturerSaving || !newManufacturerName.trim()}
              onClick={() => void onAddManufacturer()}
              className="shrink-0 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {addingManufacturerSaving ? "Adding…" : "Add"}
            </button>
          </div>
        ) : null}
      </div>
      <label className="block text-sm">
        <FieldLabel required>List price</FieldLabel>
        <MoneyInput
          value={form.listPrice}
          onChange={(listPrice) => onChange({ listPrice })}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Cost</FieldLabel>
        <MoneyInput
          value={form.cost}
          onChange={(cost) => onChange({ cost })}
        />
      </label>
      <label className="block text-sm">
        <FieldLabel>Strike-through price</FieldLabel>
        <MoneyInput
          value={form.strikeThroughPrice}
          onChange={(strikeThroughPrice) => onChange({ strikeThroughPrice })}
          placeholder="MSRP"
        />
      </label>
      <label className="block text-sm sm:col-span-2">
        <FieldLabel>Description</FieldLabel>
        <UppercaseTextarea
          value={form.notes}
          rows={3}
          onChange={(notes) => onChange({ notes })}
        />
      </label>
      <label className="inline-flex items-center gap-2 text-sm text-neutral-600 sm:col-span-2">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) => onChange({ active: e.target.checked })}
        />
        Active
      </label>
    </div>
  );
}
