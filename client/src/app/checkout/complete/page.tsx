"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, getInvoice, InvoiceItem } from "@/lib/api";

function CompleteContent() {
  const searchParams = useSearchParams();
  const invoiceId = searchParams.get("invoiceId");
  const orderId = searchParams.get("orderId");
  const token = useAuthStore((s) => s.token);

  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [message, setMessage] = useState("Confirming payment…");

  useEffect(() => {
    if (!invoiceId || !token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessage(
        orderId
          ? "Payment submitted. Your invoice will update shortly once confirmed."
          : "Payment submitted. You can close this page.",
      );
      return;
    }

    let cancelled = false;
    let attempts = 0;

    async function poll() {
      attempts += 1;
      try {
        const { invoice: inv } = await getInvoice(token!, invoiceId!);
        if (cancelled) return;
        setInvoice(inv);
        if (inv.status === "paid") {
          setMessage("Payment confirmed. Thank you!");
          return;
        }
        if (attempts < 8) {
          setMessage("Confirming payment…");
          setTimeout(poll, 1500);
        } else {
          setMessage(
            "Payment submitted. Confirmation may take a moment — check My invoices shortly.",
          );
        }
      } catch (err) {
        if (cancelled) return;
        setMessage(
          err instanceof ApiError
            ? err.message
            : "Payment submitted. Check your invoices shortly.",
        );
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, orderId, token]);

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 shadow-sm space-y-4 text-center">
        <h1 className="text-xl font-bold text-brand-dark">Checkout complete</h1>
        <p className="text-sm text-neutral-600">{message}</p>
        {invoice ? (
          <p className="text-sm text-neutral-500">
            Invoice {invoice.number} · {invoice.status}
          </p>
        ) : null}
        <Link
          href="/dashboard/orders"
          className="inline-flex rounded-lg bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          View invoices
        </Link>
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
