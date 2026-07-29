"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ApiError,
  getInvoiceByPayToken,
  InvoiceItem,
  startCheckoutByPayToken,
} from "@/lib/api";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function PayLinkPage() {
  return (
    <Suspense fallback={null}>
      <PayLinkContent />
    </Suspense>
  );
}

function PayLinkContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getInvoiceByPayToken(token)
      .then(({ invoice: inv }) => setInvoice(inv))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Pay link not found."),
      )
      .finally(() => setLoading(false));
  }, [token]);

  async function handlePay() {
    setPaying(true);
    setError(null);
    try {
      const { url } = await startCheckoutByPayToken(token);
      window.location.href = url;
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to start checkout.",
      );
      setPaying(false);
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">Pay invoice</h1>

        {loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : error && !invoice ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : invoice ? (
          <>
            <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-4 py-3 text-sm space-y-1">
              <div className="font-medium text-brand-dark">
                {invoice.number}
              </div>
              <div className="text-neutral-600">
                {invoice.lineItems[0]?.description ||
                  invoice.sourceType.replace(/_/g, " ")}
              </div>
              <div className="text-lg font-semibold text-brand-dark pt-1">
                {formatMoney(invoice.amountCents)}
              </div>
              <div className="text-xs text-neutral-500 capitalize">
                Status: {invoice.status}
              </div>
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            {invoice.status === "paid" ? (
              <p className="text-sm text-green-700">
                This invoice is paid. Thank you!
              </p>
            ) : (
              <button
                type="button"
                disabled={paying}
                onClick={handlePay}
                className="w-full rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {paying ? "Redirecting to checkout…" : "Pay securely"}
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
