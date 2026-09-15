"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Download, Mail } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink from "@/components/dashboard/DashboardBackLink";
import InvoiceDocument from "@/components/billing/InvoiceDocument";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  getInvoice,
  InvoiceItem,
  startInvoiceCheckout,
  updateInvoiceTax,
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
  const hasRole = useAuthStore((s) => s.hasRole);
  const isCustomer = user?.role === "customer";
  const canEmail = hasRole("admin", "super-admin", "owner");
  const canEditTax = useAuthStore((s) => s.hasPermission("contracts:write"));

  const [invoice, setInvoice] = useState<InvoiceItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [taxDraft, setTaxDraft] = useState("");
  const [savingTax, setSavingTax] = useState(false);

  useEffect(() => {
    if (!token || !id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getInvoice(token, id)
      .then(({ invoice: inv }) => {
        setInvoice(inv);
        setTaxDraft(((inv.taxCents ?? 0) / 100).toFixed(2));
      })
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

  async function handleSaveTax() {
    if (!token || !invoice) return;
    const dollars = Number(taxDraft);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setError("Enter a valid tax amount.");
      return;
    }
    setSavingTax(true);
    setError(null);
    try {
      const { invoice: next } = await updateInvoiceTax(token, invoice._id, {
        taxCents: Math.round(dollars * 100),
      });
      setInvoice(next);
      setTaxDraft(((next.taxCents ?? 0) / 100).toFixed(2));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to update tax.",
      );
    } finally {
      setSavingTax(false);
    }
  }

  if (!id) {
    return (
      <div className="space-y-4">
        <DashboardBackLink
          fallbackHref="/dashboard/orders"
          fallbackLabel="Back to invoices"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors print:hidden"
        />
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
        <DashboardBackLink
          fallbackHref="/dashboard/orders"
          fallbackLabel="Back to invoices"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors print:hidden"
        />
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="space-y-4">
        <DashboardBackLink
          fallbackHref="/dashboard/orders"
          fallbackLabel="Back to invoices"
          className="inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-brand-orange transition-colors print:hidden"
        />
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          Invoice not found.
        </div>
      </div>
    );
  }

  const canPay = invoice.status === "open" || invoice.status === "failed";

  return (
    <div className="mx-auto max-w-3xl space-y-4 print:max-w-none print:space-y-0">
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <DashboardBackLink
          fallbackHref="/dashboard/orders"
          fallbackLabel="Back to invoices"
        />
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 sm:w-auto"
          >
            <Download className="h-4 w-4" />
            Export to PDF
          </button>
          {isCustomer && canPay ? (
            <Link
              href={`/dashboard/checkout/?invoiceId=${invoice._id}`}
              className="w-full rounded-md bg-brand-dark px-4 py-2 text-center text-sm font-medium text-white hover:opacity-90 sm:w-auto"
            >
              Pay now
            </Link>
          ) : canEmail ? (
            invoice.customerRef ? (
              <Link
                href={`/dashboard/messaging?tab=email&invoiceId=${invoice._id}`}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 sm:w-auto"
              >
                <Mail className="h-4 w-4" />
                Email
              </Link>
            ) : (
              <button
                type="button"
                disabled
                title="This invoice has no customer to email."
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white opacity-60 sm:w-auto"
              >
                <Mail className="h-4 w-4" />
                Email
              </button>
            )
          ) : canPay ? (
            <button
              type="button"
              disabled={paying}
              onClick={handlePay}
              className="w-full rounded-md bg-brand-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 sm:w-auto"
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

      <InvoiceDocument
        invoice={invoice}
        isCustomer={isCustomer}
        taxEditor={
          !isCustomer &&
          canEditTax &&
          (invoice.status === "open" ||
            invoice.status === "draft" ||
            invoice.status === "failed") ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={taxDraft}
                onChange={(e) => setTaxDraft(e.target.value)}
                inputMode="decimal"
                aria-label="Tax amount"
                className="w-24 rounded border border-neutral-300 px-2 py-1 text-right text-sm"
              />
              <button
                type="button"
                disabled={savingTax}
                onClick={() => void handleSaveTax()}
                className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
              >
                {savingTax ? "Saving…" : "Update tax"}
              </button>
            </div>
          ) : null
        }
      />
    </div>
  );
}
