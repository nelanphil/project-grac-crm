"use client";

import { ReactNode } from "react";

type InvoiceStatusFields = {
  status: string;
  sourceType: string;
};

export function canToggleInvoiceStatus(invoice: { status: string }): boolean {
  return (
    invoice.status === "open" ||
    invoice.status === "failed" ||
    invoice.status === "paid"
  );
}

export function InvoiceStatusPill({
  invoice,
  disabled,
  onClick,
}: {
  invoice: { status: string };
  disabled?: boolean;
  onClick: () => void;
}) {
  const paid = invoice.status === "paid";
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize transition ${
        paid
          ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200 hover:bg-emerald-100"
          : "bg-sky-50 text-sky-800 ring-1 ring-sky-200 hover:bg-sky-100"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {invoice.status}
    </button>
  );
}

export function InvoiceStatusConfirm({
  message,
  busy,
  error,
  confirmLabel = "Confirm",
  onConfirm,
  onCancel,
}: {
  message: ReactNode;
  busy: boolean;
  error: string | null;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p>{message}</p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-md bg-brand-dark px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Saving…" : confirmLabel}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md border border-amber-300 px-2.5 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function invoiceStatusChangeMessage(invoice: InvoiceStatusFields): string {
  const markingPaid = invoice.status !== "paid";
  if (markingPaid) return "If you proceed, this invoice will be marked as paid.";
  const renewalNote =
    invoice.sourceType === "contract_renewal"
      ? " A recorded renewal is not undone."
      : "";
  return `If you proceed, this invoice will be marked as unpaid.${renewalNote}`;
}

export function InvoiceStatusChangeWarning({
  invoice,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  invoice: InvoiceStatusFields;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <InvoiceStatusConfirm
      message={invoiceStatusChangeMessage(invoice)}
      busy={busy}
      error={error}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export function invoiceBulkStatusMessage(
  paid: boolean,
  count: number,
  includesRenewal: boolean,
): string {
  const noun = count === 1 ? "invoice" : "invoices";
  if (paid) {
    return `If you proceed, ${count} ${noun} will be marked as paid.`;
  }
  const renewalNote = includesRenewal
    ? " A recorded renewal is not undone."
    : "";
  return `If you proceed, ${count} ${noun} will be marked as unpaid.${renewalNote}`;
}
