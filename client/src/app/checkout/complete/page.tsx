"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  CheckoutCart,
  CheckoutConfirmInvoice,
  CheckoutConfirmStatus,
  confirmCheckoutPayment,
  getCheckoutByKey,
  getMyCheckout,
} from "@/lib/api";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function statusCopy(status: CheckoutConfirmStatus | null): string {
  if (status === "paid") return "Payment confirmed. Thank you!";
  if (status === "failed") return "Payment failed. You can try again from checkout.";
  return "Confirming payment…";
}

function CompleteContent() {
  const searchParams = useSearchParams();
  const invoiceId = searchParams.get("invoiceId") ?? undefined;
  const transactionId = searchParams.get("transactionId") ?? undefined;
  const orderId = searchParams.get("orderId") ?? undefined;
  const checkoutKey = (searchParams.get("c") ?? "").trim();
  const fromDashboard = searchParams.get("from") === "dashboard";
  const token = useAuthStore((s) => s.token);

  const [status, setStatus] = useState<CheckoutConfirmStatus | null>(null);
  const [invoices, setInvoices] = useState<CheckoutConfirmInvoice[]>([]);
  const [message, setMessage] = useState("Confirming payment…");
  const [remaining, setRemaining] = useState<CheckoutCart | null>(null);

  useEffect(() => {
    if (!invoiceId && !transactionId && !orderId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessage("Payment submitted. You can close this page.");
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function confirm() {
      attempts += 1;
      try {
        const result = await confirmCheckoutPayment({
          invoiceId,
          transactionId,
          orderId,
        });
        if (cancelled) return;
        setInvoices(result.invoices);
        if (result.status === "pending" && attempts < 8) {
          setStatus("pending");
          setMessage("Confirming payment…");
          setTimeout(confirm, 1500);
          return;
        }
        setStatus(result.status);
        setMessage(statusCopy(result.status));
      } catch (err) {
        if (cancelled) return;
        const retryable =
          err instanceof ApiError && (err.status === 0 || err.status >= 500);
        if (retryable && attempts < 8) {
          setMessage("Confirming payment…");
          setTimeout(confirm, 1500);
          return;
        }
        setMessage(
          err instanceof ApiError
            ? err.message
            : "Payment submitted. Check your invoices shortly.",
        );
      }
    }

    confirm();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, transactionId, orderId]);

  useEffect(() => {
    if (status !== "paid") return;
    let cancelled = false;

    async function loadRemaining() {
      try {
        if (checkoutKey) {
          const cart = await getCheckoutByKey(checkoutKey);
          if (!cancelled) setRemaining(cart);
          return;
        }
        if (fromDashboard && token) {
          const cart = await getMyCheckout(token);
          if (!cancelled) setRemaining(cart);
        }
      } catch {
        if (!cancelled) setRemaining(null);
      }
    }

    loadRemaining();
    return () => {
      cancelled = true;
    };
  }, [status, checkoutKey, fromDashboard, token]);

  const paidTotal = invoices.reduce((sum, invoice) => sum + invoice.amountCents, 0);
  const remainingItems = remaining?.items ?? [];
  const remainingTotal = remaining?.totalCents ?? 0;
  const checkoutHref = checkoutKey
    ? `/checkout/?c=${encodeURIComponent(checkoutKey)}`
    : fromDashboard
      ? "/dashboard/checkout"
      : "/dashboard/orders";
  const invoicesHref = fromDashboard || token ? "/dashboard/orders" : checkoutHref;

  return (
    <div className="min-h-screen bg-neutral-50 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-5xl space-y-6 uppercase">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Checkout</h1>
          <p className="mt-1 text-sm text-neutral-500">{message}</p>
        </div>

        <div
          className={`rounded-xl border bg-white p-6 text-sm shadow-sm ${
            status === "paid"
              ? "border-emerald-200 text-emerald-800"
              : status === "failed"
                ? "border-red-200 text-red-700"
                : "border-neutral-200 text-neutral-600"
          }`}
        >
          {status === "paid"
            ? "Payment confirmed"
            : status === "failed"
              ? "Payment failed"
              : "Confirming payment"}
        </div>

        {invoices.length > 0 ? (
          <div className="flex flex-col gap-6 md:flex-row md:items-start">
            <section className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
              <h2 className="text-lg font-semibold text-brand-dark">
                Order Summary
              </h2>
              <ul className="space-y-2">
                {invoices.map((invoice) => (
                  <li
                    key={invoice._id}
                    className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm"
                  >
                    <div className="font-medium text-brand-dark">
                      {invoice.number}
                    </div>
                    <div className="text-neutral-600">{invoice.description}</div>
                    <div className="flex items-baseline justify-between gap-3 pt-1">
                      <div className="text-lg font-semibold text-brand-dark">
                        {formatMoney(invoice.amountCents)}
                      </div>
                      <div className="text-xs uppercase text-neutral-500">
                        {invoice.status}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="w-full shrink-0 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4 h-fit md:w-80 lg:w-96">
              <h2 className="text-lg font-semibold text-brand-dark">
                Payment Summary
              </h2>
              <div className="space-y-2 text-sm">
                <ul className="space-y-2 border-b border-neutral-200 pb-3">
                  {invoices.map((invoice) => (
                    <li
                      key={invoice._id}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <span className="min-w-0 truncate text-neutral-600">
                        {invoice.description.trim() || invoice.number}
                      </span>
                      <span className="shrink-0 font-medium text-brand-dark">
                        {formatMoney(invoice.amountCents)}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-baseline justify-between border-t border-neutral-200 pt-3">
                  <span className="text-sm font-medium text-neutral-600">
                    {status === "paid" ? "Paid" : "Total"}
                  </span>
                  <span className="text-lg font-semibold text-brand-dark">
                    {formatMoney(paidTotal)}
                  </span>
                </div>
              </div>
              <Link
                href={invoicesHref}
                className="inline-flex w-full items-center justify-center rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                View invoices
              </Link>
            </section>
          </div>
        ) : null}

        {status === "paid" && remainingItems.length > 0 ? (
          <section className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-brand-dark">
              Remaining balance
            </h2>
            <ul className="space-y-2 text-sm">
              {remainingItems.map((item) => (
                <li
                  key={`${item.kind}:${item.id}`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <span className="min-w-0 truncate text-neutral-600">
                    {item.description.trim() || item.number}
                  </span>
                  <span className="shrink-0 font-medium text-brand-dark">
                    {formatMoney(item.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between border-t border-neutral-200 pt-3 text-sm">
              <span className="font-medium text-neutral-600">Still due</span>
              <span className="text-lg font-semibold text-brand-dark">
                {formatMoney(remainingTotal)}
              </span>
            </div>
            <Link
              href={checkoutHref}
              className="inline-flex rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Pay remaining
            </Link>
          </section>
        ) : null}

        {status === "failed" ? (
          <Link
            href={checkoutHref}
            className="inline-flex rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Return to checkout
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export default function CheckoutCompletePage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">
          Loading…
        </div>
      }
    >
      <CompleteContent />
    </Suspense>
  );
}
