"use client";

import { useState } from "react";
import {
  ApiError,
  InvoiceItem,
  reconcileInvoicePosCharge,
} from "@/lib/api";

/** Unpaid Square invoices where a Tap to Pay charge may have gone through unrecorded. */
export function canCheckSquarePayment(invoice: InvoiceItem): boolean {
  if (invoice.status !== "open" && invoice.status !== "failed") return false;
  const charge = invoice.posCharge;
  if (charge) return charge.status === "pending" || charge.status === "needs_review";
  return invoice.paymentProvider === "square";
}

type Props = {
  token: string;
  invoice: InvoiceItem;
  onUpdated: (invoice: InvoiceItem) => void;
  className?: string;
};

export function usePosChargeCheck({
  token,
  invoice,
  onUpdated,
}: {
  token: string;
  invoice: InvoiceItem | null;
  onUpdated: (invoice: InvoiceItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function check() {
    if (!invoice) return;
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const result = await reconcileInvoicePosCharge(token, invoice._id);
      setMessage(result.message);
      setFailed(result.status === "needs_review" || result.status === "failed");
      onUpdated(result.invoice);
    } catch (err) {
      setFailed(true);
      setMessage(err instanceof ApiError ? err.message : "Could not check Square.");
    } finally {
      setBusy(false);
    }
  }

  return {
    available: invoice ? canCheckSquarePayment(invoice) : false,
    busy,
    message,
    failed,
    check,
  };
}

export type PosChargeCheckController = ReturnType<typeof usePosChargeCheck>;

/**
 * Status card for a Tap to Pay charge or a Square check result. Without `showButton`
 * the page offers the check elsewhere (for example in an actions menu).
 */
export function PosChargeNotice({
  invoice,
  check,
  showButton = true,
  className,
}: {
  invoice: InvoiceItem;
  check: PosChargeCheckController;
  showButton?: boolean;
  className?: string;
}) {
  const charge = invoice.posCharge;
  const pendingCharge =
    check.available &&
    (charge?.status === "pending" || charge?.status === "needs_review");
  if (!check.message && !(showButton ? check.available : pendingCharge)) return null;
  const review = charge?.status === "needs_review";

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm print:hidden ${
        review
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-neutral-200 bg-white text-neutral-700"
      } ${className ?? ""}`}
    >
      {check.available ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium">
              {charge
                ? review
                  ? "Tap to Pay needs review"
                  : "Waiting for Square to confirm Tap to Pay"
                : "Paid in Square but still open here?"}
            </p>
            <p className="mt-0.5 text-xs opacity-80">
              {charge
                ? `Started ${new Date(charge.startedAt).toLocaleString()}`
                : "Check Square for a payment matching this invoice."}
              {review && charge?.reviewReason ? ` · ${charge.reviewReason}` : ""}
              {!showButton && charge ? " · Use Actions to check Square." : ""}
            </p>
          </div>
          {showButton ? (
            <button
              type="button"
              disabled={check.busy}
              onClick={() => void check.check()}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-brand-dark px-3 py-1.5 text-sm font-medium text-brand-dark hover:bg-neutral-50 disabled:opacity-60"
            >
              {check.busy ? "Checking Square…" : "Check Square for payment"}
            </button>
          ) : null}
        </div>
      ) : null}
      {check.message ? (
        <p
          className={`${check.available ? "mt-2 " : ""}text-xs ${
            check.failed ? "text-red-700" : "text-emerald-700"
          }`}
        >
          {check.message}
        </p>
      ) : null}
    </div>
  );
}

export default function PosChargeCheck({ token, invoice, onUpdated, className }: Props) {
  const check = usePosChargeCheck({ token, invoice, onUpdated });
  if (!check.available) return null;
  return <PosChargeNotice invoice={invoice} check={check} className={className} />;
}
