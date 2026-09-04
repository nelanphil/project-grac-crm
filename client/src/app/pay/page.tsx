"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
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

function invoiceDescription(invoice: InvoiceItem): string {
  return (
    invoice.lineItems[0]?.description || invoice.sourceType.replace(/_/g, " ")
  );
}

function isUnpaid(invoice: InvoiceItem): boolean {
  return invoice.status !== "paid" && invoice.status !== "void";
}

/** Prefer ?token= (static-export safe); also accept /pay/{token}/ path segments. */
function resolvePayToken(
  pathname: string | null,
  searchToken: string | null,
): string {
  const fromQuery = (searchToken ?? "").trim();
  if (fromQuery) return fromQuery;

  const path = (pathname ?? "").replace(/\/+$/, "");
  const match = path.match(/^\/pay\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export default function PayLinkPage() {
  return (
    <Suspense fallback={null}>
      <PayLinkContent />
    </Suspense>
  );
}

function PayLinkContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const token = resolvePayToken(pathname, searchParams.get("token"));

  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [totalCents, setTotalCents] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!token) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    getInvoiceByPayToken(token)
      .then((res) => {
        const list = res.invoices?.length ? res.invoices : [res.invoice];
        setInvoices(list);
        setTotalCents(
          typeof res.totalCents === "number"
            ? res.totalCents
            : list
                .filter(isUnpaid)
                .reduce((sum, invoice) => sum + (invoice.amountCents || 0), 0),
        );
      })
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

  const unpaid = invoices.filter(isUnpaid);
  const allPaid = invoices.length > 0 && unpaid.length === 0;
  const heading =
    invoices.length > 1 ? "Pay outstanding invoices" : "Pay invoice";

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
        <h1 className="text-xl font-bold text-brand-dark">{heading}</h1>

        {!token ? (
          <p className="text-sm text-red-600">Pay link token is missing.</p>
        ) : loading ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : error && invoices.length === 0 ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : invoices.length > 0 ? (
          <>
            <ul className="space-y-2">
              {invoices.map((invoice) => (
                <li
                  key={invoice._id}
                  className="rounded-lg bg-neutral-50 border border-neutral-200 px-4 py-3 text-sm space-y-1"
                >
                  <div className="font-medium text-brand-dark">
                    {invoice.number}
                  </div>
                  <div className="text-neutral-600">
                    {invoiceDescription(invoice)}
                  </div>
                  <div className="flex items-baseline justify-between gap-3 pt-1">
                    <div className="text-lg font-semibold text-brand-dark">
                      {formatMoney(invoice.amountCents)}
                    </div>
                    <div className="text-xs text-neutral-500 capitalize">
                      {invoice.status}
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            {invoices.length > 1 ? (
              <div className="flex items-baseline justify-between border-t border-neutral-200 pt-3">
                <span className="text-sm font-medium text-neutral-600">
                  Total due
                </span>
                <span className="text-lg font-semibold text-brand-dark">
                  {formatMoney(totalCents)}
                </span>
              </div>
            ) : null}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            {allPaid ? (
              <p className="text-sm text-green-700">
                {invoices.length > 1
                  ? "These invoices are paid. Thank you!"
                  : "This invoice is paid. Thank you!"}
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
