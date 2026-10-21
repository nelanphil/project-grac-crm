"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  FinancialFilterType,
  FinancialRecordItem,
  FinancialsSummary,
  getFinancialsRecords,
  getFinancialsSummary,
} from "@/lib/api";
import TablePagination from "@/components/ui/TablePagination";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import {
  DEFAULT_PAGE_SIZE,
  paginationRange,
  type PageSize,
} from "@/lib/pagination";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ArrowUpRight,
  Clock,
  FileText,
  Search,
  X,
} from "lucide-react";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents || 0) / 100);
}

function formatDate(iso?: string | null, timeZone?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(timeZone ? { timeZone } : {}),
  });
}

function showsWorkOrderColumns(filter: FinancialFilterType): boolean {
  return (
    filter === "open_work_orders" ||
    filter === "unbilled_work" ||
    filter === "labor_hours" ||
    filter === "completed_paid"
  );
}

type Period = "month" | "last-month" | "ytd" | "all";

function periodBounds(period: Period): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "all") return {};
  if (period === "ytd") {
    return {
      from: new Date(Date.UTC(y, 0, 1)).toISOString(),
      to: now.toISOString(),
    };
  }
  if (period === "month") {
    return {
      from: new Date(Date.UTC(y, m, 1)).toISOString(),
      to: new Date(Date.UTC(y, m + 1, 1)).toISOString(),
    };
  }
  const last = m === 0 ? 11 : m - 1;
  const lastYear = m === 0 ? y - 1 : y;
  return {
    from: new Date(Date.UTC(lastYear, last, 1)).toISOString(),
    to: new Date(Date.UTC(y, m, 1)).toISOString(),
  };
}

interface FilterMeta {
  title: string;
  description: string;
  externalHref: string;
  externalLabel: string;
}

const FILTER_META: Record<FinancialFilterType, FilterMeta> = {
  invoiced: {
    title: "Invoiced Records",
    description: "All invoices issued in the selected timeframe",
    externalHref: "/dashboard/orders",
    externalLabel: "Invoices",
  },
  paid: {
    title: "Paid Invoices",
    description: "Invoices marked as paid in the selected timeframe",
    externalHref: "/dashboard/orders",
    externalLabel: "Invoices",
  },
  outstanding: {
    title: "Outstanding Invoices",
    description: "Open and draft invoices awaiting payment",
    externalHref: "/dashboard/orders",
    externalLabel: "Invoices",
  },
  past_due: {
    title: "Past Due Invoices",
    description: "Open invoices that are past their scheduled due date",
    externalHref: "/dashboard/orders",
    externalLabel: "Invoices",
  },
  open_work_orders: {
    title: "Open Work Orders",
    description: "Active work orders that have not yet been completed",
    externalHref: "/dashboard/work-orders",
    externalLabel: "Work Orders",
  },
  unbilled_work: {
    title: "Unbilled Work",
    description: "Work orders with an amount due that remain unpaid",
    externalHref: "/dashboard/work-orders",
    externalLabel: "Work Orders",
  },
  labor_hours: {
    title: "Labor Hours",
    description: "Work orders logging technician labor hours",
    externalHref: "/dashboard/work-orders",
    externalLabel: "Work Orders",
  },
  completed_paid: {
    title: "Completed & Paid",
    description:
      "Work orders marked completed and paid, by the work-order date",
    externalHref: "/dashboard/work-orders",
    externalLabel: "Work Orders",
  },
  estimates: {
    title: "Estimates",
    description: "Estimates created in the selected timeframe",
    externalHref: "/dashboard/estimates",
    externalLabel: "Estimates",
  },
};

function StatusBadge({
  status,
  isPastDue,
}: {
  status: string;
  isPastDue?: boolean;
}) {
  const s = status.toLowerCase();
  let color =
    "bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300";

  if (s === "paid" || s === "accepted" || s === "converted") {
    color =
      "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60";
  } else if (s === "open" || s === "sent") {
    color =
      "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-800/60";
  } else if (s === "completed") {
    color =
      "bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-950/40 dark:text-teal-400 dark:border-teal-800/60";
  } else if (s === "declined" || s === "void" || s === "failed") {
    color =
      "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800/60";
  } else if (s === "draft") {
    color =
      "bg-neutral-100 text-neutral-600 border border-neutral-200 dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-700";
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${color}`}
      >
        {status}
      </span>
      {isPastDue ? (
        <span className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800/60">
          Past Due
        </span>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  isSelected,
  onClick,
}: {
  label: string;
  value: string;
  hint?: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative block w-full text-left rounded-2xl border px-4 py-4 shadow-sm transition-all duration-150 cursor-pointer ${
        isSelected
          ? "border-brand-orange bg-[var(--staff-surface)] ring-2 ring-brand-orange/40 shadow-md"
          : "border-[var(--staff-border)] bg-[var(--staff-surface)] hover:-translate-y-0.5 hover:shadow-md hover:border-neutral-400"
      }`}
    >
      <div className="flex items-center justify-between">
        <p
          className={`text-xs font-semibold uppercase tracking-wide transition-colors ${
            isSelected
              ? "text-brand-orange"
              : "text-neutral-500 group-hover:text-neutral-700 dark:group-hover:text-neutral-300"
          }`}
        >
          {label}
        </p>
        {isSelected ? (
          <span className="flex h-2 w-2 rounded-full bg-brand-orange ring-4 ring-brand-orange/20 animate-pulse" />
        ) : null}
      </div>
      <p className="mt-2 text-2xl font-bold text-brand-dark">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-neutral-500">{hint}</p>
      ) : (
        <div className="mt-1 h-4" />
      )}
    </button>
  );
}

type SortKey =
  | "number"
  | "customerName"
  | "date"
  | "laborHours"
  | "paid"
  | "dueDate"
  | "total"
  | "status";

type SortDir = "asc" | "desc";

function SortHeader({
  label,
  column,
  sortKey,
  sortDir,
  onSort,
  className = "",
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortKey === column;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;

  return (
    <th
      className={`px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500 ${className}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="group inline-flex items-center gap-1.5 transition-colors hover:text-brand-dark cursor-pointer select-none"
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <Icon
          className={`h-3.5 w-3.5 transition-colors ${
            active
              ? "text-brand-orange"
              : "text-neutral-400 group-hover:text-neutral-600 dark:text-neutral-500 dark:group-hover:text-neutral-300"
          }`}
        />
      </button>
    </th>
  );
}

export default function FinancialsPage() {
  return (
    <AuthGuard>
      <FinancialsContent />
    </AuthGuard>
  );
}

function FinancialsContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const canRead = useAuthStore((s) => s.hasPermission("reports:read"));
  const [period, setPeriod] = useState<Period>("month");
  const [summary, setSummary] = useState<FinancialsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(() =>
    Boolean(token && canRead),
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Active filter card
  const [activeFilter, setActiveFilter] =
    useState<FinancialFilterType>("invoiced");

  // Records table state
  const [records, setRecords] = useState<FinancialRecordItem[]>([]);
  const [recordsTotal, setRecordsTotal] = useState(0);
  const [recordsLoading, setRecordsLoading] = useState(() =>
    Boolean(token && canRead),
  );
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const bounds = useMemo(() => periodBounds(period), [period]);
  const meta = FILTER_META[activeFilter];
  const reportTimeZone =
    activeFilter === "completed_paid" ? "UTC" : undefined;

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  // Load KPI summary
  useEffect(() => {
    let cancelled = false;
    if (!token || !canRead) return;

    void (async () => {
      try {
        const data = await getFinancialsSummary(token, bounds);
        if (!cancelled) {
          setSummary(data);
          setSummaryError(null);
          setSummaryLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setSummaryError(
            err instanceof ApiError
              ? err.message
              : "Failed to load financials summary.",
          );
          setSummaryLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, canRead, bounds]);

  // Load records for active filter
  useEffect(() => {
    let cancelled = false;
    if (!token || !canRead) return;

    void (async () => {
      try {
        const res = await getFinancialsRecords(token, {
          type: activeFilter,
          from: bounds.from,
          to: bounds.to,
          search: debouncedSearch || undefined,
          page,
          pageSize,
          sortBy: sortKey,
          sortDir,
        });
        if (!cancelled) {
          setRecords(res.records);
          setRecordsTotal(res.total);
          setRecordsError(null);
          setRecordsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setRecordsError(
            err instanceof ApiError ? err.message : "Failed to load records.",
          );
          setRecordsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    token,
    canRead,
    activeFilter,
    bounds,
    debouncedSearch,
    page,
    pageSize,
    sortKey,
    sortDir,
  ]);

  // Handle clicking a KPI card
  const handleSelectFilter = (filter: FinancialFilterType) => {
    if (activeFilter === filter) return;
    setRecordsLoading(true);
    setActiveFilter(filter);
    setPage(1);
    if (filter === "past_due") {
      setSortKey("dueDate");
      setSortDir("asc");
    } else if (filter === "labor_hours") {
      setSortKey("laborHours");
      setSortDir("desc");
    } else if (filter === "unbilled_work") {
      setSortKey("total");
      setSortDir("desc");
    } else if (filter === "completed_paid") {
      setSortKey("date");
      setSortDir("asc");
    } else {
      setSortKey("date");
      setSortDir("desc");
    }
  };

  const handleSort = (key: SortKey) => {
    setRecordsLoading(true);
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(
        key === "date" ||
          key === "dueDate" ||
          key === "total" ||
          key === "laborHours"
          ? "desc"
          : "asc",
      );
    }
    setPage(1);
  };

  // Pagination helper calculations
  const { safePage, totalPages, rangeStart, rangeEnd } = paginationRange(
    page,
    pageSize,
    recordsTotal,
  );

  const paginationProps = {
    rangeStart,
    rangeEnd,
    total: recordsTotal,
    pageSize,
    safePage,
    totalPages,
    onPageSizeChange: (newSize: PageSize) => {
      setRecordsLoading(true);
      setPageSize(newSize);
      setPage(1);
    },
    onPrev: () => {
      setRecordsLoading(true);
      setPage((p) => Math.max(1, p - 1));
    },
    onNext: () => {
      setRecordsLoading(true);
      setPage((p) => Math.min(totalPages, p + 1));
    },
  };

  if (!canRead) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold text-brand-dark">Financials</h1>
        <p className="text-sm text-neutral-500">
          You do not have access to billing analytics.
        </p>
      </div>
    );
  }

  const isTodayPastDue = (dueDate?: string | null) => {
    if (!dueDate) return false;
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return new Date(dueDate) < today;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Financials</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Billing activity across invoices, work orders, and estimates. Click
            any card to view detailed records below.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["month", "This month"],
              ["last-month", "Last month"],
              ["ytd", "Year to date"],
              ["all", "All time"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setPeriod(id);
                setSummaryLoading(true);
                setRecordsLoading(true);
                setPage(1);
              }}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition cursor-pointer ${
                period === id
                  ? "bg-brand-dark text-white shadow-sm"
                  : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {summaryError ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400">
          {summaryError}
        </div>
      ) : null}

      {summaryLoading || !summary ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-[var(--staff-surface)]">
          Loading financials…
        </div>
      ) : (
        <>
          {/* Row 1: Invoice KPI Cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Invoiced"
              value={formatMoney(summary.invoices.invoicedCents)}
              hint={`${summary.invoices.count} invoices`}
              isSelected={activeFilter === "invoiced"}
              onClick={() => handleSelectFilter("invoiced")}
            />
            <KpiCard
              label="Paid"
              value={formatMoney(summary.invoices.paidCents)}
              hint={`${summary.invoices.paidCount} paid`}
              isSelected={activeFilter === "paid"}
              onClick={() => handleSelectFilter("paid")}
            />
            <KpiCard
              label="Outstanding"
              value={formatMoney(summary.invoices.outstandingCents)}
              hint={`${summary.invoices.openCount} open`}
              isSelected={activeFilter === "outstanding"}
              onClick={() => handleSelectFilter("outstanding")}
            />
            <KpiCard
              label="Past due"
              value={formatMoney(summary.invoices.pastDueCents)}
              hint="Unpaid past scheduled date"
              isSelected={activeFilter === "past_due"}
              onClick={() => handleSelectFilter("past_due")}
            />
          </div>

          {/* Row 2: Work Order & Estimate KPI Cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Open work orders"
              value={String(summary.workOrders.openCount)}
              hint={`${summary.workOrders.completedCount} completed`}
              isSelected={activeFilter === "open_work_orders"}
              onClick={() => handleSelectFilter("open_work_orders")}
            />
            <KpiCard
              label="Unbilled work"
              value={formatMoney(summary.workOrders.unbilledCents)}
              hint="Completed & unpaid total"
              isSelected={activeFilter === "unbilled_work"}
              onClick={() => handleSelectFilter("unbilled_work")}
            />
            <KpiCard
              label="Labor hours"
              value={summary.workOrders.laborHours.toFixed(1)}
              hint="Logged labor hours"
              isSelected={activeFilter === "labor_hours"}
              onClick={() => handleSelectFilter("labor_hours")}
            />
            <KpiCard
              label="Completed & paid"
              value={formatMoney(summary.workOrders.completedPaidCents)}
              hint={`${summary.workOrders.completedPaidCount} result(s)`}
              isSelected={activeFilter === "completed_paid"}
              onClick={() => handleSelectFilter("completed_paid")}
            />
            <KpiCard
              label="Estimates"
              value={String(summary.estimates.count)}
              hint="All estimate pipeline"
              isSelected={activeFilter === "estimates"}
              onClick={() => handleSelectFilter("estimates")}
            />
          </div>

          {/* Records Table Section */}
          <div className="overflow-hidden rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] shadow-sm">
            {/* Table Header Toolbar */}
            <div className="flex flex-col gap-4 border-b border-[var(--staff-border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-brand-dark">
                    {meta.title}
                  </h2>
                  <span className="inline-flex items-center rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                    {recordsTotal}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-neutral-500">
                  {meta.description}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                {/* Search input */}
                <div className="relative min-w-[200px] max-w-xs flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search records…"
                    className="w-full rounded-lg border border-[var(--staff-border)] bg-[var(--staff-canvas)] py-1.5 pl-9 pr-8 text-xs text-brand-dark placeholder:text-neutral-400 focus:border-brand-orange focus:outline-none focus:ring-1 focus:ring-brand-orange"
                  />
                  {search ? (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>

                {/* External link to full section */}
                <Link
                  href={meta.externalHref}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--staff-border)] bg-[var(--staff-surface)] px-2.5 py-1.5 text-xs font-medium text-neutral-600 hover:border-neutral-400 hover:text-brand-dark transition dark:text-neutral-300 dark:hover:text-white"
                  title={`View in ${meta.externalLabel}`}
                >
                  <span>{meta.externalLabel} page</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            {recordsError ? (
              <div className="p-4 text-sm text-red-600 dark:text-red-400">
                {recordsError}
              </div>
            ) : null}

            {/* Top Pagination */}
            <TablePagination {...paginationProps} position="top" />

            {/* Content view */}
            <ResponsiveDataView
              isEmpty={!recordsLoading && records.length === 0}
              empty={
                <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                    <FileText className="h-6 w-6 text-neutral-400" />
                  </div>
                  <p className="mt-3 text-sm font-medium text-brand-dark">
                    No {meta.title.toLowerCase()} found
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {search
                      ? "Try clearing your search query to see all records."
                      : "There are no records matching this filter for the selected timeframe."}
                  </p>
                  {search ? (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="mt-3 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-brand-dark hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      Clear search
                    </button>
                  ) : null}
                </div>
              }
              mobile={
                <div className="divide-y divide-neutral-100 p-2 dark:divide-neutral-800">
                  {recordsLoading ? (
                    <div className="p-8 text-center text-xs text-neutral-500">
                      Loading records…
                    </div>
                  ) : (
                    records.map((r) => (
                      <MobileDataCard
                        key={r._id}
                        title={
                          <span className="font-semibold text-brand-dark">
                            {r.number}
                          </span>
                        }
                        subtitle={r.customerName}
                        badges={
                          <StatusBadge
                            status={r.status}
                            isPastDue={
                              r.recordType === "invoice" &&
                              r.status !== "paid" &&
                              isTodayPastDue(r.dueDate)
                            }
                          />
                        }
                        fields={
                          <>
                            <DataField
                              label="Date"
                              value={formatDate(r.date, reportTimeZone)}
                            />
                            {r.recordType === "invoice" && r.dueDate ? (
                              <DataField
                                label="Due"
                                value={formatDate(r.dueDate)}
                              />
                            ) : null}
                            {showsWorkOrderColumns(activeFilter) &&
                            r.laborHours != null &&
                            r.laborHours > 0 ? (
                              <DataField
                                label="Labor"
                                value={`${r.laborHours.toFixed(1)} hrs`}
                              />
                            ) : null}
                            <DataField
                              label="Total"
                              value={
                                <span className="font-semibold">
                                  {formatMoney(
                                    r.amountCents ??
                                      Math.round((r.total || 0) * 100),
                                  )}
                                </span>
                              }
                            />
                          </>
                        }
                        onClick={() => router.push(r.detailUrl)}
                      />
                    ))
                  )}
                </div>
              }
              desktop={
                <div className="overflow-x-auto">
                  {recordsLoading ? (
                    <div className="p-12 text-center text-sm text-neutral-500">
                      Loading records…
                    </div>
                  ) : (
                    <table className="min-w-full divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
                      <thead className="bg-neutral-50 dark:bg-neutral-900/50">
                        <tr>
                          <SortHeader
                            label={
                              activeFilter === "estimates"
                                ? "Estimate #"
                                : showsWorkOrderColumns(activeFilter)
                                  ? "Work Order #"
                                  : "Invoice #"
                            }
                            column="number"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={handleSort}
                          />
                          <SortHeader
                            label="Customer"
                            column="customerName"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={handleSort}
                          />
                          <SortHeader
                            label="Date"
                            column="date"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={handleSort}
                          />
                          {showsWorkOrderColumns(activeFilter) ? (
                            <>
                              <SortHeader
                                label="Labor Hours"
                                column="laborHours"
                                sortKey={sortKey}
                                sortDir={sortDir}
                                onSort={handleSort}
                              />
                              <SortHeader
                                label="Billing"
                                column="paid"
                                sortKey={sortKey}
                                sortDir={sortDir}
                                onSort={handleSort}
                              />
                            </>
                          ) : null}
                          {activeFilter === "past_due" ||
                          activeFilter === "outstanding" ||
                          activeFilter === "invoiced" ? (
                            <SortHeader
                              label="Due Date"
                              column="dueDate"
                              sortKey={sortKey}
                              sortDir={sortDir}
                              onSort={handleSort}
                            />
                          ) : null}
                          <SortHeader
                            label="Total"
                            column="total"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={handleSort}
                          />
                          <SortHeader
                            label="Status"
                            column="status"
                            sortKey={sortKey}
                            sortDir={sortDir}
                            onSort={handleSort}
                          />
                          <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {records.map((r) => {
                          const isPastDueInvoice =
                            r.recordType === "invoice" &&
                            r.status !== "paid" &&
                            isTodayPastDue(r.dueDate);

                          return (
                            <tr
                              key={r._id}
                              role="link"
                              tabIndex={0}
                              onClick={() => router.push(r.detailUrl)}
                              onKeyDown={(event) => {
                                const target = event.target as HTMLElement;
                                if (target.closest("button, a, input")) return;
                                if (
                                  event.key === "Enter" ||
                                  event.key === " "
                                ) {
                                  event.preventDefault();
                                  router.push(r.detailUrl);
                                }
                              }}
                              className="cursor-pointer transition hover:bg-neutral-50/80 focus-visible:bg-neutral-50 focus-visible:outline-none dark:hover:bg-neutral-800/50"
                            >
                              <td className="px-6 py-4 font-semibold text-brand-dark">
                                {r.number}
                              </td>
                              <td className="px-6 py-4 text-neutral-700 dark:text-neutral-300">
                                {r.customerName || "—"}
                              </td>
                              <td className="px-6 py-4 text-neutral-500">
                                {formatDate(r.date, reportTimeZone)}
                              </td>
                              {showsWorkOrderColumns(activeFilter) ? (
                                <>
                                  <td className="px-6 py-4">
                                    {r.laborHours != null &&
                                    r.laborHours > 0 ? (
                                      <span className="inline-flex items-center gap-1 font-medium text-brand-dark">
                                        <Clock className="h-3.5 w-3.5 text-neutral-400" />
                                        {r.laborHours.toFixed(1)} hrs
                                      </span>
                                    ) : (
                                      <span className="text-neutral-400">
                                        0.0 hrs
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-6 py-4">
                                    {r.paid ? (
                                      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60">
                                        Paid
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800/60">
                                        Unbilled
                                      </span>
                                    )}
                                  </td>
                                </>
                              ) : null}
                              {activeFilter === "past_due" ||
                              activeFilter === "outstanding" ||
                              activeFilter === "invoiced" ? (
                                <td className="px-6 py-4 text-neutral-500">
                                  {r.dueDate ? (
                                    <span
                                      className={
                                        isPastDueInvoice
                                          ? "font-semibold text-rose-600 dark:text-rose-400"
                                          : ""
                                      }
                                    >
                                      {formatDate(r.dueDate)}
                                    </span>
                                  ) : (
                                    "—"
                                  )}
                                </td>
                              ) : null}
                              <td className="px-6 py-4 font-semibold text-brand-dark">
                                {formatMoney(
                                  r.amountCents ??
                                    Math.round((r.total || 0) * 100),
                                )}
                              </td>
                              <td className="px-6 py-4">
                                <StatusBadge
                                  status={r.status}
                                  isPastDue={isPastDueInvoice}
                                />
                              </td>
                              <td className="px-6 py-4 text-right">
                                <Link
                                  href={r.detailUrl}
                                  onClick={(e) => e.stopPropagation()}
                                  className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-brand-dark hover:bg-neutral-100 dark:hover:bg-neutral-800"
                                >
                                  View
                                  <ArrowUpRight className="h-3 w-3 text-neutral-400" />
                                </Link>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              }
            />

            {/* Bottom Pagination */}
            <TablePagination {...paginationProps} position="bottom" />
          </div>
        </>
      )}
    </div>
  );
}
