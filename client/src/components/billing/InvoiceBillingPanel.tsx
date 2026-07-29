"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ApiError,
  createInvoice,
  createInvoicePayLink,
  getInvoices,
  InvoiceItem,
  InvoiceSourceType,
  startInvoiceCheckout,
} from "@/lib/api";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type Props = {
  token: string;
  sourceType: InvoiceSourceType;
  contractRef?: string;
  workOrderRef?: string;
  title?: string;
};

export default function InvoiceBillingPanel({
  token,
  sourceType,
  contractRef,
  workOrderRef,
  title = "Billing",
}: Props) {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    getInvoices(token, {
      contractRef,
      workOrderRef,
    })
      .then(({ invoices: list }) => setInvoices(list))
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load invoices.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, contractRef, workOrderRef]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    setPayUrl(null);
    try {
      const { invoice } = await createInvoice(token, {
        sourceType,
        contractRef,
        workOrderRef,
      });
      setInvoices((prev) => [invoice, ...prev]);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        reload();
      }
      setError(
        err instanceof ApiError ? err.message : "Failed to create invoice.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePayLink(id: string) {
    setBusy(true);
    setError(null);
    try {
      const { payUrl: url } = await createInvoicePayLink(token, id);
      setPayUrl(url);
      await navigator.clipboard?.writeText(url);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create pay link.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckout(id: string) {
    setBusy(true);
    setError(null);
    try {
      const { url } = await startInvoiceCheckout(token, id);
      window.location.href = url;
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to start checkout.",
      );
      setBusy(false);
    }
  }

  const createLabel =
    sourceType === "work_order"
      ? "Invoice work order"
      : sourceType === "contract_renewal"
        ? "Create renewal invoice"
        : "Create invoice";

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand-dark">{title}</h2>
          <p className="text-sm text-neutral-500 mt-0.5">
            Generate an invoice and collect payment via the configured checkout
            provider.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={handleCreate}
          className="shrink-0 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {createLabel}
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {payUrl && (
        <div className="rounded-md bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800 break-all">
          Pay link copied: {payUrl}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-neutral-500">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="text-sm text-neutral-500">No invoices yet.</p>
      ) : (
        <ul className="divide-y divide-neutral-100 text-sm">
          {invoices.map((inv) => (
            <li
              key={inv._id}
              className="py-3 flex flex-wrap items-center justify-between gap-3"
            >
              <div>
                <div className="font-medium text-brand-dark">
                  {inv.number}{" "}
                  <span className="text-neutral-500 font-normal">
                    · {formatMoney(inv.amountCents)}
                  </span>
                </div>
                <div className="text-xs text-neutral-500 capitalize">
                  {inv.status}
                  {inv.paidAt
                    ? ` · paid ${new Date(inv.paidAt).toLocaleDateString()}`
                    : ""}
                </div>
              </div>
              {inv.status === "open" || inv.status === "failed" ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handlePayLink(inv._id)}
                    className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                  >
                    Copy pay link
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleCheckout(inv._id)}
                    className="rounded-md bg-brand-orange px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                  >
                    Collect payment
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
