"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import InvoiceDocument from "@/components/billing/InvoiceDocument";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  getInvoice,
  InvoiceItem,
  startInvoiceCheckout,
} from "@/lib/api";

export default function InvoiceDetailPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="text-sm text-neutral-500 py-6">Loading invoice…</div>
        }
      >
        <InvoiceDetailContent />
      </Suspense>
    </AuthGuard>
  );
}

function InvoiceDetailContent() {
  const searchParams = useSearchParams();
  const id = searchParams.get("id") ?? "";
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const isCustomer = user?.role === "customer";

  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    if (!token || !id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getInvoice(token, id)
      .then(({ invoice: inv }) => setInvoice(inv))
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load invoice.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, id]);

  async function handlePay() {
    if (!token || !invoice) return;
    setPaying(true);
    setError(null);
    try {
      const { url } = await startInvoiceCheckout(token, invoice._id);
      window.location.href = url;
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to start checkout.",
      );
      setPaying(false);
    }
  }

  if (!id) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors print:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Link>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Missing invoice id.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="text-sm text-neutral-500 py-6">Loading invoice…</div>
    );
  }

  if (error && !invoice) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors print:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Link>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="space-y-4">
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors print:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Link>
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Invoice not found.
        </div>
      </div>
    );
  }

  const canPay = invoice.status === "open" || invoice.status === "failed";

  return (
    <div className="mx-auto max-w-3xl space-y-4 print:max-w-none print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/dashboard/orders"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to invoices
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Download className="h-4 w-4" />
            Export to PDF
          </button>
          {canPay ? (
            <button
              type="button"
              disabled={paying}
              onClick={handlePay}
              className="rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
            >
              {paying ? "Redirecting…" : "Pay now"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 print:hidden">
          {error}
        </div>
      ) : null}

      <InvoiceDocument invoice={invoice} isCustomer={isCustomer} />
    </div>
  );
}
