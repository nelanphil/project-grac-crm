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

export default function PosChargeCheck({ token, invoice, onUpdated, className }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  if (!canCheckSquarePayment(invoice)) return null;
  const charge = invoice.posCharge;
  const review = charge?.status === "needs_review";

  async function check() {
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

  return (
    <div
      className={`rounded-md border px-4 py-3 text-sm print:hidden ${
        review
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-neutral-200 bg-white text-neutral-700"
      } ${className ?? ""}`}
    >
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
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void check()}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-brand-dark px-3 py-1.5 text-sm font-medium text-brand-dark hover:bg-neutral-50 disabled:opacity-60"
        >
          {busy ? "Checking Square…" : "Check Square for payment"}
        </button>
      </div>
      {message ? (
        <p className={`mt-2 text-xs ${failed ? "text-red-700" : "text-emerald-700"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
