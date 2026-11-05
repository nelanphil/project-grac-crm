"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { InvoiceStatusPill } from "@/components/billing/InvoiceStatusActions";
import PastDueBadge from "@/components/billing/PastDueBadge";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import {
  ApiError,
  getInvoices,
  type InvoiceItem,
  type InvoiceSourceType,
} from "@/lib/api";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

function invoiceSourceLabel(sourceType: InvoiceSourceType | string): string {
  if (sourceType === "work_order") return "Work order";
  if (sourceType === "contract_initial") return "Contract";
  if (sourceType === "contract_renewal") return "Renewal";
  return sourceType.replace(/_/g, " ");
}

function isOpenInvoicePastDue(invoice: InvoiceItem): boolean {
  if (invoice.status !== "open" && invoice.status !== "failed") return false;
  if (!invoice.dueDate) return false;
  const due = new Date(invoice.dueDate);
  if (Number.isNaN(due.getTime())) return false;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() < startOfToday.getTime();
}

/** Invoices billed from the work order, plus the renewal that created the visit. */
export function invoicesForWorkOrder(
  order: { _id: string; renewalInvoiceRef?: string | null },
  invoices: InvoiceItem[],
): InvoiceItem[] {
  const seen = new Set<string>();
  const matched: InvoiceItem[] = [];
  for (const invoice of invoices) {
    const linkedByWorkOrder = invoice.workOrderRef === order._id;
    const linkedByRenewal =
      Boolean(order.renewalInvoiceRef) &&
      invoice._id === order.renewalInvoiceRef;
    if ((!linkedByWorkOrder && !linkedByRenewal) || seen.has(invoice._id)) {
      continue;
    }
    seen.add(invoice._id);
    matched.push(invoice);
  }
  return matched;
}

export function WorkOrderInvoiceList({
  invoices,
  loading = false,
}: {
  invoices: InvoiceItem[];
  loading?: boolean;
}) {
  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
        Invoices
      </p>
      {loading ? (
        <p className="mt-1 text-xs text-neutral-500">Loading invoices…</p>
      ) : invoices.length === 0 ? (
        <p className="mt-1 text-xs text-neutral-400">No invoices</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {invoices.map((invoice) => {
            const pastDue = isOpenInvoicePastDue(invoice);
            return (
              <li key={invoice._id}>
                <Link
                  href={`/dashboard/orders/detail?id=${invoice._id}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100"
                >
                  <span className="font-medium text-brand-dark">
                    {invoice.number}
                  </span>
                  <span className="text-neutral-600">
                    {formatDate(invoice.issuedAt)}
                  </span>
                  <span className="text-neutral-600">
                    {formatMoney(invoice.amountCents)}
                  </span>
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    <InvoiceStatusPill invoice={invoice} />
                    {pastDue ? (
                      <PastDueBadge
                        pastDue={{
                          count: 1,
                          totalCents: invoice.amountCents,
                        }}
                      />
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function CustomerInvoicesTab({
  token,
  customerRef,
  customerId,
  onCountChange,
  onLoaded,
}: {
  token: string;
  customerRef: string;
  customerId: number;
  onCountChange?: (count: number) => void;
  onLoaded?: (invoices: InvoiceItem[], customerRef: string) => void;
}) {
  const router = useRouter();
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const requestKey = `${customerRef}:${customerId}`;
  const loading = loadedKey !== requestKey;

  useEffect(() => {
    let cancelled = false;
    getInvoices(token, { customerRef, customerId })
      .then(({ invoices: rows }) => {
        if (cancelled) return;
        setInvoices(rows);
        setError(null);
        setLoadedKey(`${customerRef}:${customerId}`);
        onCountChange?.(rows.length);
        onLoaded?.(rows, customerRef);
      })
      .catch((err) => {
        if (cancelled) return;
        setInvoices([]);
        setError(
          err instanceof ApiError ? err.message : "Failed to load invoices.",
        );
        setLoadedKey(`${customerRef}:${customerId}`);
        onCountChange?.(0);
        onLoaded?.([], customerRef);
      });
    return () => {
      cancelled = true;
    };
  }, [token, customerRef, customerId, onCountChange, onLoaded]);

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading invoices…</p>;
  }

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (invoices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-16 text-center shadow-sm">
        <FileText className="mb-4 h-10 w-10 text-neutral-300" />
        <p className="text-sm font-medium text-neutral-500">No invoices yet</p>
        <p className="mt-1 text-xs text-neutral-400">
          Invoices for this customer will appear here.
        </p>
      </div>
    );
  }

  return (
    <ResponsiveDataView
      mobile={invoices.map((invoice) => {
        const pastDue = isOpenInvoicePastDue(invoice);
        return (
          <MobileDataCard
            key={invoice._id}
            title={invoice.number}
            subtitle={invoiceSourceLabel(invoice.sourceType)}
            onClick={() =>
              router.push(`/dashboard/orders/detail?id=${invoice._id}`)
            }
            badges={
              <>
                <InvoiceStatusPill invoice={invoice} />
                {pastDue ? (
                  <PastDueBadge
                    pastDue={{
                      count: 1,
                      totalCents: invoice.amountCents,
                    }}
                  />
                ) : null}
              </>
            }
            fields={
              <>
                <DataField label="Issued" value={formatDate(invoice.issuedAt)} />
                <DataField label="Due" value={formatDate(invoice.dueDate)} />
                <DataField
                  label="Amount"
                  value={formatMoney(invoice.amountCents)}
                />
              </>
            }
          />
        );
      })}
      desktop={
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-100 text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Number
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Issued
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Source
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Due
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Amount
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {invoices.map((invoice) => {
                  const pastDue = isOpenInvoicePastDue(invoice);
                  return (
                    <tr
                      key={invoice._id}
                      className="cursor-pointer hover:bg-neutral-50"
                      onClick={() =>
                        router.push(`/dashboard/orders/detail?id=${invoice._id}`)
                      }
                    >
                      <td className="whitespace-nowrap px-6 py-4 font-medium text-brand-dark">
                        {invoice.number}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-neutral-600">
                        {formatDate(invoice.issuedAt)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-neutral-600">
                        {invoiceSourceLabel(invoice.sourceType)}
                      </td>
                      <td
                        className={`whitespace-nowrap px-6 py-4 ${
                          pastDue ? "font-medium text-red-700" : "text-neutral-600"
                        }`}
                      >
                        {formatDate(invoice.dueDate)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-neutral-600">
                        {formatMoney(invoice.amountCents)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <InvoiceStatusPill invoice={invoice} />
                          {pastDue ? (
                            <PastDueBadge
                              pastDue={{
                                count: 1,
                                totalCents: invoice.amountCents,
                              }}
                            />
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      }
    />
  );
}
