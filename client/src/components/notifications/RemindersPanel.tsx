"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Bell, Search } from "lucide-react";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import TablePagination from "@/components/ui/TablePagination";
import {
  ApiError,
  getReminders,
  ReminderListItem,
  updateReminderCompleted,
} from "@/lib/api";
import { paginationRange, type PageSize } from "@/lib/pagination";

const REMINDER_PAGE_SIZES = [50, 150, 250] as const;

type SortKey = "note" | "ticket" | "customer" | "created" | "completed";
type SortDir = "asc" | "desc";

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === column;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex items-center gap-1 transition-colors hover:text-brand-dark"
      >
        {label}
        <Icon
          className={`h-3.5 w-3.5 ${active ? "text-brand-dark" : "text-neutral-300"}`}
        />
      </button>
    </th>
  );
}

function ticketHref(item: ReminderListItem): string {
  return item.source === "estimate"
    ? `/dashboard/estimates/detail?id=${item.ticketId}`
    : `/dashboard/work-orders/detail?id=${item.ticketId}`;
}

function formatCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function RemindersPanel({ token }: { token: string }) {
  const [items, setItems] = useState<ReminderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("created");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(handle);
  }, [search]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getReminders(token, {
      page,
      pageSize,
      search: debounced || undefined,
      sort: sortKey,
      dir: sortDir,
      showCompleted,
    })
      .then((res) => {
        setItems(res.reminders);
        setTotal(res.total);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load reminders."),
      )
      .finally(() => setLoading(false));
  }, [token, page, pageSize, debounced, sortKey, sortDir, showCompleted]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "created" ? "desc" : "asc");
    }
    setPage(1);
  }

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
    pageSizeOptions: REMINDER_PAGE_SIZES,
    onPageSizeChange: (size: PageSize) => {
      setPageSize(size);
      setPage(1);
    },
    onPrev: () => setPage((current) => Math.max(1, current - 1)),
    onNext: () => setPage((current) => Math.min(totalPages, current + 1)),
  };

  async function toggleCompleted(item: ReminderListItem) {
    const next = !item.completed;
    const hideAfterComplete = next && !showCompleted;
    setPendingId(item.id);
    setItems((prev) =>
      hideAfterComplete
        ? prev.filter((row) => row.id !== item.id)
        : prev.map((row) => (row.id === item.id ? { ...row, completed: next } : row)),
    );
    if (hideAfterComplete) setTotal((count) => Math.max(0, count - 1));
    try {
      await updateReminderCompleted(token, item.source, item.id, next);
    } catch (err) {
      setItems((prev) => {
        if (!hideAfterComplete) {
          return prev.map((row) =>
            row.id === item.id ? { ...row, completed: item.completed } : row,
          );
        }
        return [...prev, item].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      });
      if (hideAfterComplete) setTotal((count) => count + 1);
      setError(err instanceof ApiError ? err.message : "Failed to update reminder.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search note, work order, or customer"
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>
        <div className="inline-flex shrink-0 items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={showCompleted}
            aria-label="Show completed"
            onClick={() => {
              setShowCompleted((current) => !current);
              setPage(1);
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange/40 ${
              showCompleted ? "bg-brand-orange" : "bg-neutral-200"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                showCompleted ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-sm text-neutral-700">Show completed</span>
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading reminders…
        </div>
      ) : (
        <ResponsiveDataView
          isEmpty={items.length === 0}
          empty={
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
              <Bell className="mb-4 h-10 w-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">
                {showCompleted ? "No reminders yet" : "No open reminders"}
              </p>
            </div>
          }
          mobile={
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="top" />
              </div>
              {items.map((item) => (
                <MobileDataCard
                  key={`${item.source}-${item.id}`}
                  title={item.ticketNumber}
                  subtitle={item.customerName || "—"}
                  fields={
                    <>
                      <DataField label="Note" value={item.content} />
                      <DataField label="Created" value={formatCreated(item.createdAt)} />
                    </>
                  }
                  actions={
                    <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        disabled={pendingId === item.id}
                        onChange={() => void toggleCompleted(item)}
                      />
                      Completed
                    </label>
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
                    <SortHeader
                      label="Note"
                      column="note"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Work order #"
                      column="ticket"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Customer"
                      column="customer"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Date created"
                      column="created"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Completed"
                      column="completed"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {items.map((item) => (
                    <tr key={`${item.source}-${item.id}`}>
                      <td className="max-w-md px-6 py-4 text-neutral-700">
                        <p className="whitespace-pre-wrap">{item.content}</p>
                      </td>
                      <td className="px-6 py-4 font-medium text-brand-dark">
                        <Link href={ticketHref(item)} className="hover:underline">
                          {item.ticketNumber}
                        </Link>
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {item.customerName || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {formatCreated(item.createdAt)}
                      </td>
                      <td className="px-6 py-4">
                        <input
                          type="checkbox"
                          checked={item.completed}
                          disabled={pendingId === item.id}
                          aria-label={`Completed for ${item.ticketNumber}`}
                          onChange={() => void toggleCompleted(item)}
                        />
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
