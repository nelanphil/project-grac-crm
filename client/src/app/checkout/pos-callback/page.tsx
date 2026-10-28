"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  confirmInvoicePosCharge,
  InvoiceItem,
  reconcileInvoicePosCharge,
} from "@/lib/api";
import {
  invoiceIdFromPosState,
  parsePosCallback,
  posCallbackMessage,
} from "@/lib/squarePos";

function PosCallbackContent() {
  const searchParams = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const query = searchParams.toString();

  const [status, setStatus] = useState<"pending" | "paid" | "failed" | null>(
    null,
  );
  const [message, setMessage] = useState("Confirming payment…");
  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [linkedInvoiceId, setLinkedInvoiceId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [canceled, setCanceled] = useState(false);

  useEffect(() => {
    if (!token) return;
    const params = new URLSearchParams(query);
    const callback = parsePosCallback(params);
    if (!callback) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("failed");
      setMessage("No payment result was returned.");
      return;
    }
    const invoiceId = callback.state
      ? invoiceIdFromPosState(callback.state)
      : null;
    if (invoiceId) setLinkedInvoiceId(invoiceId);
    if (!callback.ok) {
      setStatus("failed");
      setMessage(posCallbackMessage(callback.errorCode));
      setCanceled(callback.errorCode === "payment_canceled");
      if (invoiceId && callback.state) {
        void confirmInvoicePosCharge(token, invoiceId, {
          transactionId: "",
          state: callback.state,
          error: callback.errorCode,
        }).catch(() => {});
      }
      return;
    }
    if (!invoiceId) {
      setStatus("failed");
      setMessage("This payment session is invalid.");
      return;
    }

    const transactionId = callback.transactionId;
    const clientTransactionId = callback.clientTransactionId;
    const state = callback.state;
    let cancelled = false;
    let attempts = 0;

    async function confirm() {
      attempts += 1;
      try {
        const result = await confirmInvoicePosCharge(token!, invoiceId!, {
          transactionId,
          clientTransactionId,
          state,
        });
        if (cancelled) return;
        setInvoice(result.invoice);
        if (result.status === "pending" && attempts < 8) {
          setStatus("pending");
          setMessage("Confirming payment…");
          setTimeout(confirm, 1500);
          return;
        }
        setStatus(result.status === "paid" ? "paid" : "failed");
        setMessage(
          result.status === "paid"
            ? "Payment confirmed."
            : result.status === "pending"
              ? "Square is still processing this payment. Check the invoice in a moment."
              : "Payment failed. No invoice was marked paid.",
        );
      } catch (err) {
        if (cancelled) return;
        const retryable =
          err instanceof ApiError && (err.status === 0 || err.status >= 500);
        if (retryable && attempts < 8) {
          setStatus("pending");
          setMessage("Confirming payment…");
          setTimeout(confirm, 1500);
          return;
        }
        setStatus("failed");
        setMessage(
          err instanceof ApiError
            ? err.message
            : "Could not confirm the payment.",
        );
      }
    }

    confirm();
    return () => {
      cancelled = true;
    };
  }, [token, query]);

  async function checkSquare() {
    if (!token || !linkedInvoiceId) return;
    setChecking(true);
    try {
      const result = await reconcileInvoicePosCharge(token, linkedInvoiceId);
      setInvoice(result.invoice);
      setStatus(
        result.status === "paid"
          ? "paid"
          : result.status === "pending"
            ? "pending"
            : "failed",
      );
      setMessage(result.message);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "Could not check Square.");
    } finally {
      setChecking(false);
    }
  }

  const invoiceId = invoice?._id || linkedInvoiceId;
  const canRetry =
    status !== "paid" && status !== null && Boolean(linkedInvoiceId) && !canceled;
  const backHref = invoice?.workOrderRef
    ? `/dashboard/work-orders/detail?id=${invoice.workOrderRef}`
    : invoiceId
      ? `/dashboard/orders/detail?id=${invoiceId}`
      : "/dashboard/orders";
  const backLabel = invoice?.workOrderRef ? "Back to work order" : "Back to invoice";

  return (
    <div className="min-h-screen bg-neutral-50 flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-lg space-y-4">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Tap to Pay</h1>
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
              ? "Payment not completed"
              : "Confirming payment"}
        </div>
        {canRetry ? (
          <button
            type="button"
            disabled={checking}
            onClick={() => void checkSquare()}
            className="inline-flex w-full items-center justify-center rounded-lg border border-brand-dark px-4 py-2.5 text-sm font-medium text-brand-dark hover:bg-neutral-100 disabled:opacity-60"
          >
            {checking ? "Checking Square…" : "Check Square again"}
          </button>
        ) : null}
        <Link
          href={backHref}
          className="inline-flex w-full items-center justify-center rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          {backLabel}
        </Link>
      </div>
    </div>
  );
}

export default function PosCallbackPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="min-h-screen flex items-center justify-center text-sm text-neutral-500">
            Loading…
          </div>
        }
      >
        <PosCallbackContent />
      </Suspense>
    </AuthGuard>
  );
}
