"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ApiError,
  createInvoicePayLink,
  getInvoices,
  InvoiceItem,
  startInvoiceCheckout,
} from "@/lib/api";

export type CustomerBillToSnapshot = {
  name: string;
  address?: string;
  city?: string;
  zip?: string;
  phone?: string;
  email?: string;
  customerRef?: string | null;
};

const PAGE_SIZE = 5;

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function invoiceSourceLabel(sourceType: InvoiceItem["sourceType"]): string {
  if (sourceType === "work_order") return "Work order";
  if (sourceType === "contract_renewal") return "Renewal";
  return "Contract";
}

function paymentProviderLabel(
  provider: InvoiceItem["paymentProvider"],
): string | null {
  if (provider === "square") return "Square";
  if (provider === "stripe") return "Stripe";
  if (provider === "paypal") return "PayPal";
  return null;
}

function invoicePaymentIdLine(inv: InvoiceItem): string | null {
  if (inv.status !== "paid") return null;
  const provider = paymentProviderLabel(inv.paymentProvider);
  if (inv.providerPaymentId) {
    return [provider, `Payment ID ${inv.providerPaymentId}`]
      .filter(Boolean)
      .join(" · ");
  }
  if (inv.providerOrderId) {
    return [provider, `Order ID ${inv.providerOrderId}`]
      .filter(Boolean)
      .join(" · ");
  }
  return null;
}

export default function CustomerBillToCard({
  customer,
  token,
  workOrderRef,
  refreshKey = 0,
}: {
  customer: CustomerBillToSnapshot;
  token: string;
  workOrderRef?: string;
  refreshKey?: number;
}) {
  const cityZip = [customer.city, customer.zip].filter(Boolean).join(" ");
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payUrl, setPayUrl] = useState<string | null>(null);

  const customerRef = customer.customerRef ?? undefined;

  const reload = useCallback(
    (nextPage = page) => {
      setLoading(true);
      setError(null);
      getInvoices(token, {
        ...(customerRef
          ? { customerRef, page: nextPage, pageSize: PAGE_SIZE }
          : { workOrderRef, page: nextPage, pageSize: PAGE_SIZE }),
      })
        .then(({ invoices: list, total: totalCount }) => {
          setInvoices(list);
          setTotal(totalCount ?? list.length);
        })
        .catch((err) =>
          setError(
            err instanceof ApiError ? err.message : "Failed to load invoices.",
          ),
        )
        .finally(() => setLoading(false));
    },
    [token, customerRef, workOrderRef, page],
  );

  useEffect(() => {
    setPage(1);
  }, [refreshKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload(page);
  }, [reload, page, refreshKey]);

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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4 print:hidden">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Customer
        </p>
        <div className="mt-2 space-y-0.5 text-sm text-neutral-700">
          <p className="font-semibold text-brand-dark">
            {customer.customerRef ? (
              <Link
                href={`/dashboard/customers/detail?id=${customer.customerRef}`}
                className="hover:text-brand-orange"
              >
                {customer.name || "—"}
              </Link>
            ) : (
              customer.name || "—"
            )}
          </p>
          {customer.address ? <p>{customer.address}</p> : null}
          {cityZip ? <p>{cityZip}</p> : null}
          {customer.phone ? <p>{customer.phone}</p> : null}
          {customer.email ? <p>{customer.email}</p> : null}
        </div>
      </div>

      <div className="border-t border-neutral-100 pt-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Recent invoices
        </p>

        {error ? (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {payUrl ? (
          <div className="mb-3 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 break-all">
            Checkout link copied: {payUrl}
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-neutral-500">Loading invoices…</p>
        ) : invoices.length === 0 ? (
          <p className="text-sm text-neutral-500">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-100 text-sm">
            {invoices.map((inv) => {
              const isThisWorkOrder = Boolean(
                workOrderRef && inv.workOrderRef === workOrderRef,
              );
              const paymentIdLine = invoicePaymentIdLine(inv);
              return (
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
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                      <span>{invoiceSourceLabel(inv.sourceType)}</span>
                      {isThisWorkOrder ? (
                        <span className="rounded-full bg-brand-dark/10 px-1.5 py-0.5 font-medium text-brand-dark">
                          This work order
                        </span>
                      ) : null}
                      <span className="capitalize">
                        · {inv.status}
                        {inv.paidAt
                          ? ` · paid ${new Date(inv.paidAt).toLocaleDateString()}`
                          : ""}
                      </span>
                    </div>
                    {paymentIdLine ? (
                      <p className="mt-0.5 break-all text-xs text-neutral-500">
                        {paymentIdLine}
                      </p>
                    ) : null}
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
              );
            })}
          </ul>
        )}

        {total > PAGE_SIZE ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
            <p className="text-xs text-neutral-500">
              Showing {rangeStart}&ndash;{rangeEnd} of {total}
            </p>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-brand-dark hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Previous
              </button>
              <span className="px-2 text-xs text-neutral-500">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-brand-dark hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
