"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import {
  canToggleInvoiceStatus,
  invoiceBulkStatusMessage,
  InvoiceStatusChangeWarning,
  InvoiceStatusConfirm,
  InvoiceStatusPill,
} from "@/components/billing/InvoiceStatusActions";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import TablePagination from "@/components/ui/TablePagination";
import { useAuthStore } from "@/store/useAuthStore";
import { isCustomerRole } from "@/lib/dashboard-role";
import {
  ApiError,
  bulkUpdateInvoiceStatus,
  getInvoices,
  InvoiceItem,
  markInvoicePaid,
  reopenInvoice,
} from "@/lib/api";
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

function PageSelectCheckbox({
  checked,
  indeterminate,
  label,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      className="h-4 w-4"
    />
  );
}

function mergeInvoice(current: InvoiceItem, updated: InvoiceItem): InvoiceItem {
  return {
    ...current,
    ...updated,
    customerName: current.customerName,
    contactName: current.contactName,
  };
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
  const canWrite = useAuthStore((s) => s.hasPermission("contracts:write"));
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [pendingStatusId, setPendingStatusId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [bulkIntent, setBulkIntent] = useState<"paid" | "unpaid" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isCustomer = isCustomerRole(user);
  const showActions = canWrite && !isCustomer;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setSelectedIds(new Set());
    setPendingStatusId(null);
    setBulkIntent(null);
    setActionError(null);
  }, [page, pageSize, debounced]);

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

  const pageIds = invoices.map((invoice) => invoice._id);
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id));
  const allSelected = pageIds.length > 0 && selectedOnPage.length === pageIds.length;
  const someSelected = selectedOnPage.length > 0 && !allSelected;
  const selectedInvoices = invoices.filter((invoice) =>
    selectedIds.has(invoice._id),
  );
  const markPaidTargets = selectedInvoices.filter(
    (invoice) => invoice.status === "open" || invoice.status === "failed",
  );
  const markUnpaidTargets = selectedInvoices.filter(
    (invoice) => invoice.status === "paid",
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

  function toggleRow(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkIntent(null);
    setActionError(null);
  }

  function toggleSelectAll() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allSelected) {
        for (const id of pageIds) next.delete(id);
      } else {
        for (const id of pageIds) next.add(id);
      }
      return next;
    });
    setBulkIntent(null);
    setActionError(null);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setBulkIntent(null);
    setActionError(null);
  }

  function beginStatusChange(invoice: InvoiceItem) {
    if (!showActions || !canToggleInvoiceStatus(invoice)) return;
    setActionError(null);
    setBulkIntent(null);
    setPendingStatusId((current) =>
      current === invoice._id ? null : invoice._id,
    );
  }

  async function confirmStatusChange(invoice: InvoiceItem) {
    if (!token) return;
    setStatusBusyId(invoice._id);
    setActionError(null);
    try {
      const { invoice: updated } =
        invoice.status === "paid"
          ? await reopenInvoice(token, invoice._id)
          : await markInvoicePaid(token, invoice._id);
      setInvoices((list) =>
        list.map((item) =>
          item._id === updated._id ? mergeInvoice(item, updated) : item,
        ),
      );
      setPendingStatusId(null);
    } catch (err) {
      setActionError(
        err instanceof ApiError
          ? err.message
          : "Failed to update invoice status.",
      );
    } finally {
      setStatusBusyId(null);
    }
  }

  function beginBulk(intent: "paid" | "unpaid") {
    setPendingStatusId(null);
    setActionError(null);
    setBulkIntent((current) => (current === intent ? null : intent));
  }

  async function confirmBulk() {
    if (!token || !bulkIntent) return;
    const targets = bulkIntent === "paid" ? markPaidTargets : markUnpaidTargets;
    if (targets.length === 0) return;
    setBulkBusy(true);
    setActionError(null);
    try {
      const result = await bulkUpdateInvoiceStatus(token, {
        ids: targets.map((invoice) => invoice._id),
        paid: bulkIntent === "paid",
      });
      const byId = new Map(result.updated.map((invoice) => [invoice._id, invoice]));
      setInvoices((list) =>
        list.map((item) => {
          const updated = byId.get(item._id);
          return updated ? mergeInvoice(item, updated) : item;
        }),
      );
      setSelectedIds(new Set());
      setBulkIntent(null);
      setPendingStatusId(null);
      if (result.failed.length > 0) {
        setActionError(
          `Updated ${result.updated.length}. ${result.failed.length} could not be updated.`,
        );
      }
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to update invoices.",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  function openInvoice(id: string) {
    router.push(`/dashboard/orders/detail?id=${id}`);
  }

  function statusControl(invoice: InvoiceItem) {
    if (!showActions || !canToggleInvoiceStatus(invoice)) {
      return (
        <span
          className={`inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 ${isCustomer ? "uppercase" : "capitalize"}`}
        >
          {invoice.status}
        </span>
      );
    }
    return (
      <InvoiceStatusPill
        invoice={invoice}
        disabled={statusBusyId === invoice._id || bulkBusy}
        onClick={() => beginStatusChange(invoice)}
      />
    );
  }

  const columnCount = showActions ? 6 : 5;

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

      {actionError && !pendingStatusId && !bulkIntent ? (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading invoices…
        </div>
      ) : (
        <div className="space-y-3">
          {showActions && selectedIds.size > 0 ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
                <span className="text-sm font-medium text-brand-dark">
                  {selectedIds.size} selected
                </span>
                <button
                  type="button"
                  disabled={markPaidTargets.length === 0 || bulkBusy}
                  onClick={() => beginBulk("paid")}
                  className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  Mark as paid
                </button>
                <button
                  type="button"
                  disabled={markUnpaidTargets.length === 0 || bulkBusy}
                  onClick={() => beginBulk("unpaid")}
                  className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                >
                  Mark as unpaid
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={clearSelection}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-brand-dark disabled:opacity-60"
                >
                  Clear
                </button>
              </div>
              {bulkIntent ? (
                <InvoiceStatusConfirm
                  message={invoiceBulkStatusMessage(
                    bulkIntent === "paid",
                    bulkIntent === "paid"
                      ? markPaidTargets.length
                      : markUnpaidTargets.length,
                    bulkIntent === "unpaid" &&
                      markUnpaidTargets.some(
                        (invoice) => invoice.sourceType === "contract_renewal",
                      ),
                  )}
                  busy={bulkBusy}
                  error={actionError}
                  onConfirm={() => void confirmBulk()}
                  onCancel={() => {
                    setBulkIntent(null);
                    setActionError(null);
                  }}
                />
              ) : null}
            </div>
          ) : null}

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
                {showActions ? (
                  <label className="flex items-center gap-2 px-1 text-sm text-neutral-600">
                    <PageSelectCheckbox
                      checked={allSelected}
                      indeterminate={someSelected}
                      label="Select all invoices on this page"
                      onChange={toggleSelectAll}
                    />
                    Select all on this page
                  </label>
                ) : null}
                {invoices.map((inv) => {
                  const pending = pendingStatusId === inv._id;
                  return (
                    <MobileDataCard
                      key={inv._id}
                      title={
                        showActions ? (
                          <span className="inline-flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(inv._id)}
                              aria-label={`Select invoice ${inv.number}`}
                              onClick={(event) => event.stopPropagation()}
                              onChange={() => toggleRow(inv._id)}
                              className="h-4 w-4"
                            />
                            {inv.number}
                          </span>
                        ) : (
                          inv.number
                        )
                      }
                      subtitle={invoiceCustomerLabel(inv)}
                      badges={statusControl(inv)}
                      fields={
                        <>
                          <DataField
                            label="Type"
                            value={
                              <span
                                className={
                                  isCustomer ? "uppercase" : "capitalize"
                                }
                              >
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
                      onClick={() => openInvoice(inv._id)}
                    >
                      {pending ? (
                        <div className="mt-3">
                          <InvoiceStatusChangeWarning
                            invoice={inv}
                            busy={statusBusyId === inv._id}
                            error={actionError}
                            onConfirm={() => void confirmStatusChange(inv)}
                            onCancel={() => {
                              setPendingStatusId(null);
                              setActionError(null);
                            }}
                          />
                        </div>
                      ) : null}
                    </MobileDataCard>
                  );
                })}
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
                      {showActions ? (
                        <th className="w-10 px-4 py-3">
                          <PageSelectCheckbox
                            checked={allSelected}
                            indeterminate={someSelected}
                            label="Select all invoices on this page"
                            onChange={toggleSelectAll}
                          />
                        </th>
                      ) : null}
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
                    {invoices.map((inv) => {
                      const pending = pendingStatusId === inv._id;
                      return (
                        <Fragment key={inv._id}>
                          <tr
                            role="link"
                            tabIndex={0}
                            onClick={() => openInvoice(inv._id)}
                            onKeyDown={(event) => {
                              const target = event.target as HTMLElement;
                              if (target.closest("button, a, input, label")) {
                                return;
                              }
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                openInvoice(inv._id);
                              }
                            }}
                            className="cursor-pointer transition hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:outline-none"
                          >
                            {showActions ? (
                              <td
                                className="w-10 px-4 py-4"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(inv._id)}
                                  aria-label={`Select invoice ${inv.number}`}
                                  onChange={() => toggleRow(inv._id)}
                                  className="h-4 w-4"
                                />
                              </td>
                            ) : null}
                            <td className="px-6 py-4 font-medium text-brand-dark">
                              {inv.number}
                              <div className="text-xs font-normal text-neutral-400">
                                {new Date(inv.issuedAt).toLocaleDateString()}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-neutral-600">
                              {invoiceCustomerLabel(inv)}
                            </td>
                            <td
                              className={`px-6 py-4 text-neutral-600 ${isCustomer ? "uppercase" : "capitalize"}`}
                            >
                              {inv.sourceType.replace(/_/g, " ")}
                            </td>
                            <td className="px-6 py-4 text-neutral-700">
                              {formatMoney(inv.amountCents)}
                            </td>
                            <td className="px-6 py-4">{statusControl(inv)}</td>
                          </tr>
                          {pending ? (
                            <tr>
                              <td colSpan={columnCount} className="px-6 pb-4">
                                <InvoiceStatusChangeWarning
                                  invoice={inv}
                                  busy={statusBusyId === inv._id}
                                  error={actionError}
                                  onConfirm={() => void confirmStatusChange(inv)}
                                  onCancel={() => {
                                    setPendingStatusId(null);
                                    setActionError(null);
                                  }}
                                />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                <TablePagination {...paginationProps} position="bottom" />
              </div>
            }
          />
        </div>
      )}
    </div>
  );
}
