"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import TablePagination from "@/components/ui/TablePagination";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, getInvoices, InvoiceItem } from "@/lib/api";
import {
  DEFAULT_PAGE_SIZE,
  paginationRange,
  type PageSize,
} from "@/lib/pagination";
import { invoiceCustomerLabel } from "@/lib/formatName";
import { FileText, Search } from "lucide-react";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export default function OrdersPage() {
  return (
    <AuthGuard>
      <OrdersContent />
    </AuthGuard>
  );
}

function OrdersContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  const isCustomer = user?.role === "customer";

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getInvoices(token, {
      page,
      pageSize,
      search: !isCustomer && debounced ? debounced : undefined,
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
  }, [token, page, pageSize, debounced, isCustomer]);

  const hasOutstanding = invoices.some(
    (invoice) => invoice.status === "open" || invoice.status === "failed",
  );

  const { safePage, totalPages, rangeStart, rangeEnd } = paginationRange(
    page,
    pageSize,
    total,
  );

  const paginationProps = {
    rangeStart,
    rangeEnd,
    total,
    pageSize,
    safePage,
    totalPages,
    onPageSizeChange: (size: PageSize) => {
      setPageSize(size);
      setPage(1);
    },
    onPrev: () => setPage((p) => Math.max(1, p - 1)),
    onNext: () => setPage((p) => Math.min(totalPages, p + 1)),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">
            {isCustomer ? "My invoices" : "Invoices"}
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            {isCustomer
              ? "View and pay open invoices for your contracts and work orders."
              : "All invoices across customers."}
          </p>
        </div>
        {isCustomer && hasOutstanding ? (
          <Link
            href="/dashboard/checkout"
            className="inline-flex items-center justify-center rounded-lg bg-brand-dark px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            Pay outstanding
          </Link>
        ) : null}
      </div>

      {!isCustomer ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer or contact"
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-orange"
          />
        </div>
      ) : null}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading invoices…
        </div>
      ) : (
        <ResponsiveDataView
          isEmpty={invoices.length === 0}
          empty={
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
              <FileText className="h-10 w-10 text-neutral-300 mb-4" />
              <p className="text-sm font-medium text-neutral-500">
                No invoices yet
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Invoices for renewals and work orders will appear here.
              </p>
            </div>
          }
          mobile={
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="top" />
              </div>
              {invoices.map((inv) => (
                <MobileDataCard
                  key={inv._id}
                  title={inv.number}
                  subtitle={invoiceCustomerLabel(inv)}
                  badges={
                    <span className={`inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ${isCustomer ? "uppercase" : "capitalize"}`}>
                      {inv.status}
                    </span>
                  }
                  fields={
                    <>
                      <DataField
                        label="Type"
                        value={
                          <span className={isCustomer ? "uppercase" : "capitalize"}>
                            {inv.sourceType.replace(/_/g, " ")}
                          </span>
                        }
                      />
                      <DataField
                        label="Amount"
                        value={formatMoney(inv.amountCents)}
                      />
                    </>
                  }
                  onClick={() =>
                    router.push(`/dashboard/orders/detail?id=${inv._id}`)
                  }
                />
              ))}
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="bottom" />
              </div>
            </div>
          }
          desktop={
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <TablePagination {...paginationProps} position="top" />
              <table className="min-w-full divide-y divide-neutral-100 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Invoice
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Amount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {invoices.map((inv) => (
                    <tr
                      key={inv._id}
                      role="link"
                      tabIndex={0}
                      onClick={() =>
                        router.push(`/dashboard/orders/detail?id=${inv._id}`)
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(
                            `/dashboard/orders/detail?id=${inv._id}`,
                          );
                        }
                      }}
                      className="cursor-pointer transition hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none"
                    >
                      <td className="px-6 py-4 font-medium text-brand-dark">
                        {inv.number}
                        <div className="text-xs font-normal text-neutral-400">
                          {new Date(inv.issuedAt).toLocaleDateString()}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {invoiceCustomerLabel(inv)}
                      </td>
                      <td className={`px-6 py-4 text-neutral-600 ${isCustomer ? "uppercase" : "capitalize"}`}>
                        {inv.sourceType.replace(/_/g, " ")}
                      </td>
                      <td className="px-6 py-4 text-neutral-700">
                        {formatMoney(inv.amountCents)}
                      </td>
                      <td className={`px-6 py-4 text-neutral-600 ${isCustomer ? "uppercase" : "capitalize"}`}>
                        {inv.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TablePagination {...paginationProps} position="bottom" />
            </div>
          }
        />
      )}
    </div>
  );
}
