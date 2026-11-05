"use client";

import type { ReactNode } from "react";
import { ticketTotals } from "@/lib/service-ticket";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

function formatTaxRate(rate: number): string {
  const rounded = Math.round(rate * 10000) / 10000;
  return `${rounded}%`;
}

function taxInputValue(amount: number): string {
  if (!amount) return "";
  return String(amount);
}

const moneyInputClass =
  "w-28 rounded border border-neutral-300 px-2 py-1 text-right text-sm disabled:opacity-60";

export type TicketTotals = ReturnType<typeof ticketTotals>;

export type TicketTotalsPatch = {
  miscExp?: string;
  shipping?: string;
  tax?: string;
  taxOverridden?: boolean;
};

export default function TicketTotalsBox({
  totals,
  miscExp,
  shipping,
  tax,
  taxOverridden,
  discountBanner,
  onPatch,
  disabled = false,
  footer,
}: {
  totals: TicketTotals;
  miscExp: string;
  shipping: string;
  tax: string;
  taxOverridden: boolean;
  discountBanner?: string | null;
  onPatch?: (patch: TicketTotalsPatch) => void;
  disabled?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div className="w-full shrink-0 space-y-2 rounded border border-neutral-200 p-3 text-sm lg:w-72">
      {discountBanner ? (
        <p className="rounded bg-sky-50 px-2 py-1.5 text-xs text-sky-800">
          {discountBanner}
        </p>
      ) : null}
      <div className="flex justify-between">
        <span>Total parts</span>
        <span>{formatMoney(totals.totalParts)}</span>
      </div>
      <div className="flex justify-between">
        <span>Total labor</span>
        <span>{formatMoney(totals.totalLabor)}</span>
      </div>
      <div className="flex justify-between">
        <span>Total agreements</span>
        <span>{formatMoney(totals.totalAgreements)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>Misc exp.</span>
        <input
          value={miscExp}
          disabled={disabled}
          onChange={(event) => onPatch?.({ miscExp: event.target.value })}
          className={moneyInputClass}
        />
      </div>
      <div className="flex justify-between border-t border-neutral-200 pt-2">
        <span>Sub total</span>
        <span>{formatMoney(totals.subtotal)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>Shipping</span>
        <input
          value={shipping}
          disabled={disabled}
          onChange={(event) => onPatch?.({ shipping: event.target.value })}
          className={moneyInputClass}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span>
          Tax
          {totals.taxRate > 0 ? ` (${formatTaxRate(totals.taxRate)})` : ""}
        </span>
        <input
          value={taxOverridden ? tax : taxInputValue(totals.tax)}
          disabled={disabled}
          onChange={(event) =>
            onPatch?.({ tax: event.target.value, taxOverridden: true })
          }
          className={moneyInputClass}
        />
      </div>
      <div className="flex justify-between border-t border-neutral-200 pt-2 font-semibold">
        <span>Total</span>
        <span>{formatMoney(totals.total)}</span>
      </div>
      {footer ? <div className="pt-2">{footer}</div> : null}
    </div>
  );
}
