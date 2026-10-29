"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useAuthStore } from "@/store/useAuthStore";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import TablePagination from "@/components/ui/TablePagination";
import {
  ApiError,
  bulkCreateRenewalWorkOrders,
  createRenewalWorkOrder,
  dismissPaidRenewal,
  getPaidRenewals,
  linkRenewalWorkOrder,
  resendRenewalScheduleEmail,
  type InvoiceItem,
} from "@/lib/api";
import {
  DEFAULT_PAGE_SIZE,
  paginationRange,
  type PageSize,
} from "@/lib/pagination";
import { formatDateOnly } from "@/lib/contractDates";
import { invoiceCustomerLabel } from "@/lib/formatName";
import { FileText, Search } from "lucide-react";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

type CreatedVisit = { invoiceId: string; id: string; number: string };

export default function PaidRenewalsPanel() {
  const token = useAuthStore((s) => s.token);
  const canWrite = useAuthStore((s) => s.hasPermission("contracts:write"));
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkNumber, setLinkNumber] = useState("");
  const [dismissId, setDismissId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedVisit[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  const requestKey = `${token ?? ""}|${page}|${pageSize}|${debounced}`;
  const loading = !token || loadedKey !== requestKey;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const key = `${token}|${page}|${pageSize}|${debounced}`;
    getPaidRenewals(token, {
      page,
      pageSize,
      search: debounced || undefined,
    })
      .then(({ invoices: list, total: totalCount }) => {
        if (cancelled) return;
        setInvoices(list);
        setTotal(totalCount ?? list.length);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? err.message : "Failed to load paid renewals.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, pageSize, debounced]);

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
    onPrev: () => setPage((current) => Math.max(1, current - 1)),
    onNext: () => setPage((current) => Math.min(totalPages, current + 1)),
  };

  function dropInvoices(ids: string[]) {
    const gone = new Set(ids);
    setInvoices((list) => list.filter((invoice) => !gone.has(invoice._id)));
    setTotal((count) => Math.max(0, count - ids.length));
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      return next;
    });
  }

  async function createOne(invoiceId: string) {
    if (!token) return;
    setBusyId(invoiceId);
    setError(null);
    setNotice(null);
    try {
      const { workOrder } = await createRenewalWorkOrder(token, invoiceId);
      dropInvoices([invoiceId]);
      setCreated((list) => [
        {
          invoiceId,
          id: workOrder.workOrderId,
          number: workOrder.number || "Work order",
        },
        ...list,
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create the work order.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function createSelected() {
    if (!token || selectedIds.size === 0) return;
    const ids = [...selectedIds];
    setBulkBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await bulkCreateRenewalWorkOrders(token, ids);
      dropInvoices(result.created.map((item) => item.invoiceId));
      setCreated((list) => [
        ...result.created.map((item) => ({
          invoiceId: item.invoiceId,
          id: item.workOrderId,
          number: item.number || "Work order",
        })),
        ...list,
      ]);
      if (result.failed.length > 0) {
        setError(
          `Created ${result.created.length}. ${result.failed.length} could not be created.`,
        );
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create work orders.",
      );
    } finally {
      setBulkBusy(false);
    }
  }

  async function linkOne(invoiceId: string) {
    if (!token || !linkNumber.trim()) return;
    setBusyId(invoiceId);
    setError(null);
    try {
      const { workOrder } = await linkRenewalWorkOrder(
        token,
        invoiceId,
        linkNumber.trim(),
      );
      dropInvoices([invoiceId]);
      setLinkingId(null);
      setLinkNumber("");
      setNotice(`Linked ${workOrder.number || "work order"}.`);
      setCreated((list) => [
        {
          invoiceId,
          id: workOrder.workOrderId,
          number: workOrder.number || "Work order",
        },
        ...list,
      ]);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to link the work order.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function dismissOne(invoiceId: string) {
    if (!token) return;
    setBusyId(invoiceId);
    setError(null);
    try {
      await dismissPaidRenewal(token, invoiceId);
      dropInvoices([invoiceId]);
      setDismissId(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to dismiss this renewal.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function resendOne(invoiceId: string) {
    if (!token) return;
    setBusyId(invoiceId);
    setError(null);
    setNotice(null);
    try {
      const result = await resendRenewalScheduleEmail(token, invoiceId);
      setNotice(result.message);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to send the scheduling email.",
      );
    } finally {
      setBusyId(null);
    }
  }

  function rowActions(invoice: InvoiceItem) {
    if (!canWrite) return null;
    const busy = busyId === invoice._id || bulkBusy;
    return (
      <div
        className="flex flex-wrap gap-2"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          disabled={busy}
          onClick={() => void createOne(invoice._id)}
          className="rounded-md bg-brand-dark px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {busyId === invoice._id ? "Working…" : "Create work order"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setLinkingId((current) =>
              current === invoice._id ? null : invoice._id,
            );
            setLinkNumber("");
            setDismissId(null);
          }}
          className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
        >
          Link existing
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void resendOne(invoice._id)}
          className="rounded-md border border-neutral-300 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
        >
          Resend email
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDismissId((current) =>
              current === invoice._id ? null : invoice._id,
            );
            setLinkingId(null);
          }}
          className="rounded-md px-2.5 py-1 text-xs font-medium text-neutral-500 hover:text-brand-dark disabled:opacity-60"
        >
          Dismiss
        </button>
      </div>
    );
  }

  function rowExtras(invoice: InvoiceItem) {
    if (linkingId === invoice._id) {
      return (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void linkOne(invoice._id);
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            value={linkNumber}
            onChange={(event) => setLinkNumber(event.target.value)}
            placeholder="Work order number"
            className="w-48 rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={busyId === invoice._id || !linkNumber.trim()}
            className="rounded-md bg-brand-dark px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            Link
          </button>
        </form>
      );
    }
    if (dismissId === invoice._id) {
      return (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600"
          onClick={(event) => event.stopPropagation()}
        >
          <span>Remove this paid renewal from the report?</span>
          <button
            type="button"
            disabled={busyId === invoice._id}
            onClick={() => void dismissOne(invoice._id)}
            className="rounded-md bg-brand-dark px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60"
          >
            Dismiss
          </button>
          <button
            type="button"
            onClick={() => setDismissId(null)}
            className="text-xs font-medium text-neutral-500 hover:text-brand-dark"
          >
            Cancel
          </button>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by customer, contact, or invoice"
          className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-orange"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}
      {created.length > 0 ? (
        <p className="text-sm text-neutral-600">
          Work orders:{" "}
          {created.map((visit, index) => (
            <Fragment key={`${visit.id}-${index}`}>
              {index > 0 ? ", " : null}
              <Link
                href={`/dashboard/work-orders/detail?id=${visit.id}`}
                className="font-medium text-brand-orange hover:underline"
              >
                {visit.number}
              </Link>
            </Fragment>
          ))}
        </p>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading paid renewals…
        </div>
      ) : (
        <>
          {canWrite && selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm">
              <span className="text-sm font-medium text-brand-dark">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void createSelected()}
                className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {bulkBusy ? "Creating…" : "Create work orders"}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setSelectedIds(new Set())}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-neutral-500 hover:text-brand-dark"
              >
                Clear
              </button>
            </div>
          ) : null}
          <ResponsiveDataView
            isEmpty={invoices.length === 0}
            empty={
              <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
                <FileText className="mb-4 h-10 w-10 text-neutral-300" />
                <p className="text-sm font-medium text-neutral-500">
                  No paid renewals are waiting for a work order
                </p>
              </div>
            }
            mobile={
              <div className="space-y-3">
                <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                  <TablePagination {...paginationProps} position="top" />
                </div>
                {invoices.map((invoice) => (
                  <MobileDataCard
                    key={invoice._id}
                    title={invoice.number}
                    subtitle={invoiceCustomerLabel(invoice)}
                    fields={
                      <>
                        <DataField
                          label="Paid"
                          value={
                            invoice.paidAt
                              ? formatDateOnly(invoice.paidAt)
                              : "—"
                          }
                        />
                        <DataField
                          label="Amount"
                          value={formatMoney(invoice.amountCents)}
                        />
                        {invoice.contractLabel ? (
                          <DataField label="Contract" value={invoice.contractLabel} />
                        ) : null}
                      </>
                    }
                  >
                    {rowActions(invoice)}
                    {rowExtras(invoice)}
                  </MobileDataCard>
                ))}
              </div>
            }
            desktop={
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="top" />
                <table className="min-w-full divide-y divide-neutral-100 text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      {canWrite ? <th className="w-10 px-4 py-3" /> : null}
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Invoice
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Paid
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Amount
                      </th>
                      {canWrite ? (
                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {invoices.map((invoice) => (
                      <Fragment key={invoice._id}>
                        <tr className="align-top">
                          {canWrite ? (
                            <td className="w-10 px-4 py-4">
                              <input
                                type="checkbox"
                                checked={selectedIds.has(invoice._id)}
                                aria-label={`Select invoice ${invoice.number}`}
                                onChange={() =>
                                  setSelectedIds((current) => {
                                    const next = new Set(current);
                                    if (next.has(invoice._id)) next.delete(invoice._id);
                                    else next.add(invoice._id);
                                    return next;
                                  })
                                }
                                className="h-4 w-4"
                              />
                            </td>
                          ) : null}
                          <td className="px-6 py-4 font-medium text-brand-dark">
                            <Link
                              href={`/dashboard/orders/detail?id=${invoice._id}`}
                              className="hover:underline"
                            >
                              {invoice.number}
                            </Link>
                            {invoice.contractLabel ? (
                              <div className="text-xs font-normal text-neutral-400">
                                {invoice.contractLabel}
                              </div>
                            ) : null}
                          </td>
                          <td className="px-6 py-4 text-neutral-600">
                            {invoiceCustomerLabel(invoice)}
                          </td>
                          <td className="px-6 py-4 text-neutral-600">
                            {invoice.paidAt ? formatDateOnly(invoice.paidAt) : "—"}
                          </td>
                          <td className="px-6 py-4 text-neutral-700">
                            {formatMoney(invoice.amountCents)}
                          </td>
                          {canWrite ? (
                            <td className="px-6 py-4">{rowActions(invoice)}</td>
                          ) : null}
                        </tr>
                        {linkingId === invoice._id || dismissId === invoice._id ? (
                          <tr>
                            <td
                              colSpan={canWrite ? 6 : 4}
                              className="px-6 pb-4"
                            >
                              {rowExtras(invoice)}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
                <TablePagination {...paginationProps} position="bottom" />
              </div>
            }
          />
        </>
      )}
    </div>
  );
}
