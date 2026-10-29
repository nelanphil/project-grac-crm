"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";
import { InvoiceActivityTimeline } from "@/components/billing/InvoiceActivityPanel";
import {
  ApiError,
  getCustomerPaymentInvoices,
  getInvoiceActivity,
  type CustomerPaymentInvoice,
  type InvoiceActivity,
  type InvoiceStatus,
} from "@/lib/api";

const STATUS_TONE: Record<InvoiceStatus, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-red-50 text-red-700 border-red-200",
  open: "bg-neutral-50 text-neutral-600 border-neutral-200",
  draft: "bg-neutral-50 text-neutral-600 border-neutral-200",
  void: "bg-neutral-50 text-neutral-500 border-neutral-200",
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function InvoicePaymentLog({
  token,
  invoiceId,
}: {
  token: string;
  invoiceId: string;
}) {
  const [activity, setActivity] = useState<InvoiceActivity | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getInvoiceActivity(token, invoiceId)
      .then((next) => {
        if (!cancelled) setActivity(next);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load this payment log.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, invoiceId]);

  if (error) {
    return <p className="px-3 pb-3 text-xs text-red-700">{error}</p>;
  }
  if (!activity) {
    return <p className="px-3 pb-3 text-xs text-neutral-500">Loading payment log…</p>;
  }
  return (
    <div className="border-t border-neutral-100 px-3 pb-1">
      <InvoiceActivityTimeline token={token} invoiceId={invoiceId} activity={activity} />
    </div>
  );
}

export default function CustomerPaymentActivity({
  token,
  customerId,
  enabled,
}: {
  token: string;
  customerId: string;
  enabled: boolean;
}) {
  const [invoices, setInvoices] = useState<CustomerPaymentInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    getCustomerPaymentInvoices(token, customerId)
      .then((result) => {
        if (!cancelled) setInvoices(result.invoices);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load payment activity.");
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, enabled, token]);

  if (!enabled) return null;
  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!invoices || invoices.length === 0) return null;

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
        Payment activity
      </h3>
      <ul className="space-y-2">
        {invoices.map((invoice) => {
          const open = openId === invoice.id;
          const tone = STATUS_TONE[invoice.status] ?? STATUS_TONE.open;
          return (
            <li
              key={invoice.id}
              className="overflow-hidden rounded-lg border border-neutral-200 bg-white"
            >
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : invoice.id)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2.5 text-left"
                >
                  {open ? (
                    <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                  ) : (
                    <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-neutral-900">{invoice.number}</span>
                      <span
                        className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${tone}`}
                      >
                        {invoice.status}
                      </span>
                      <span className="text-sm font-medium text-neutral-800">
                        {formatMoney(invoice.amountCents)}
                      </span>
                    </span>
                    <span className="mt-0.5 block text-[11px] text-neutral-400">
                      {formatWhen(invoice.latestAt)}
                    </span>
                  </span>
                </button>
                <Link
                  href={`/dashboard/orders/detail?id=${invoice.id}`}
                  className="flex items-center px-3 text-xs font-medium text-brand-orange hover:underline"
                >
                  Open
                </Link>
              </div>
              {open ? <InvoicePaymentLog token={token} invoiceId={invoice.id} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
