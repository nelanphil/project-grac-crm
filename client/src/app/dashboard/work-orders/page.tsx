"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Search } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import FilterStatsCards, {
  FilterStatItem,
} from "@/components/ui/FilterStatsCards";
import TablePagination from "@/components/ui/TablePagination";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  getWorkOrders,
  restoreWorkOrder,
  updateWorkOrder,
  WorkOrderListItem,
} from "@/lib/api";
import { timeWindowError, workOrderLocalDate, formatMonthDayYear } from "@/lib/schedule";
import {
  DEFAULT_PAGE_SIZE,
  paginationRange,
  type PageSize,
} from "@/lib/pagination";

type PaidFilter = "all" | "unpaid" | "paid";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

function displayOrderDate(order: WorkOrderListItem): string {
  const local = workOrderLocalDate(order);
  return local ? formatMonthDayYear(local) : "—";
}

function displayNumber(order: WorkOrderListItem): string {
  return order.number || (order.legacyId ? String(order.legacyId) : order._id.slice(-6));
}

const timeInputClass =
  "w-[7.25rem] rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700 focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:opacity-60";

function WindowTimeInput({
  label,
  field,
  order,
  token,
  onSaved,
}: {
  label: string;
  field: "startTime" | "endTime";
  order: WorkOrderListItem;
  token: string | null;
  onSaved: (order: WorkOrderListItem) => void;
}) {
  const stored = order[field] ?? "";
  const [local, setLocal] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocal(stored);
    setError(null);
  }, [stored]);

  async function commit() {
    const next = local.trim();
    if (next === stored) {
      setError(null);
      return;
    }
    const startTime = field === "startTime" ? next : (order.startTime ?? "");
    const endTime = field === "endTime" ? next : (order.endTime ?? "");
    const message = timeWindowError(startTime, endTime);
    if (message) {
      setError(message);
      return;
    }
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await updateWorkOrder(token, order._id, {
        [field]: next,
      });
      onSaved(updated);
    } catch (err) {
      setLocal(stored);
      setError(err instanceof ApiError ? err.message : "Could not save time");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input
        type="time"
        aria-label={label}
        value={local}
        disabled={saving}
        onChange={(event) => {
          setLocal(event.target.value);
          setError(null);
        }}
        onBlur={() => void commit()}
        className={timeInputClass}
      />
      {error ? <p className="mt-1 max-w-[9rem] text-[11px] text-amber-700">{error}</p> : null}
    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <AuthGuard>
      <WorkOrdersContent />
    </AuthGuard>
  );
}

function WorkOrdersContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const canViewDeleted = useAuthStore(
    (s) =>
      s.hasRole("admin", "super-admin") ||
      Boolean(s.user?.capabilities?.territoryOwner),
  );
  const [orders, setOrders] = useState<WorkOrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [paidFilter, setPaidFilter] = useState<PaidFilter>("all");
  const [listView, setListView] = useState<"active" | "deleted">("active");
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [stats, setStats] = useState({ total: 0, unpaid: 0, paid: 0 });
  const [statsLoading, setStatsLoading] = useState(true);
  const showingDeleted = canViewDeleted && listView === "deleted";

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    getWorkOrders(token, {
      page,
      pageSize,
      search: debounced || undefined,
      paid:
        showingDeleted
          ? undefined
          : paidFilter === "paid"
            ? true
            : paidFilter === "unpaid"
              ? false
              : undefined,
      deleted: showingDeleted,
    })
      .then((res) => {
        setOrders(res.workOrders);
        setTotal(res.total);
        if (res.stats) {
          setStats(res.stats);
          setStatsLoading(false);
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load work orders."),
      )
      .finally(() => setLoading(false));
  }, [token, page, pageSize, debounced, paidFilter, showingDeleted]);

  const { safePage, totalPages, rangeStart, rangeEnd } = paginationRange(
    page,
    pageSize,
    total,
  );

  function saveOrderTimes(updated: WorkOrderListItem) {
    setOrders((current) =>
      current.map((order) =>
        order._id === updated._id
          ? {
              ...order,
              startTime: updated.startTime ?? "",
              endTime: updated.endTime ?? "",
            }
          : order,
      ),
    );
  }

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

  const value = (n: number) => (statsLoading ? "—" : String(n));
  const statItems: FilterStatItem<PaidFilter>[] = [
    { label: "Total", value: value(stats.total), tone: "neutral", filter: "all" },
    { label: "Unpaid", value: value(stats.unpaid), tone: "warning", filter: "unpaid" },
    { label: "Paid", value: value(stats.paid), tone: "success", filter: "paid" },
  ];

  async function handleRestore(orderId: string) {
    if (!token) return;
    setRestoringId(orderId);
    setError(null);
    try {
      await restoreWorkOrder(token, orderId);
      setOrders((current) => current.filter((order) => order._id !== orderId));
      setTotal((current) => Math.max(0, current - 1));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to restore work order.",
      );
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Work orders</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Service tickets, labor, and parts used to generate invoices.
          </p>
        </div>
        {canViewDeleted ? (
          <div className="inline-flex shrink-0 self-start rounded-lg border border-neutral-200 bg-white p-0.5 text-sm">
            <button
              type="button"
              onClick={() => {
                if (listView === "active") return;
                setListView("active");
                setOrders([]);
                setLoading(true);
                setPage(1);
                setError(null);
              }}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                listView === "active"
                  ? "bg-brand-dark text-white"
                  : "text-neutral-600 hover:text-brand-dark"
              }`}
            >
              Active
            </button>
            <button
              type="button"
              onClick={() => {
                if (listView === "deleted") return;
                setListView("deleted");
                setOrders([]);
                setLoading(true);
                setPage(1);
                setError(null);
              }}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                listView === "deleted"
                  ? "bg-brand-dark text-white"
                  : "text-neutral-600 hover:text-brand-dark"
              }`}
            >
              Deleted
            </button>
          </div>
        ) : null}
      </div>

      {showingDeleted ? null : (
      <FilterStatsCards
        title="Work order stats"
        icon={ClipboardList}
        columns={3}
        items={statItems}
        selected={paidFilter}
        onSelect={(filter) => {
          setPaidFilter(filter);
          setPage(1);
        }}
      />
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, customer, or technician"
          className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading work orders…
        </div>
      ) : (
        <ResponsiveDataView
          isEmpty={orders.length === 0}
          empty={
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
              <ClipboardList className="mb-4 h-10 w-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">
                {showingDeleted ? "No deleted work orders." : "No work orders yet"}
              </p>
            </div>
          }
          mobile={
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="top" />
              </div>
              {orders.map((order) => (
                <MobileDataCard
                  key={order._id}
                  title={displayNumber(order)}
                  subtitle={order.customerName || "—"}
                  onClick={() =>
                    router.push(`/dashboard/work-orders/detail?id=${order._id}`)
                  }
                  actions={
                    showingDeleted ? (
                      <button
                        type="button"
                        disabled={restoringId === order._id}
                        onClick={() => void handleRestore(order._id)}
                        className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-60"
                      >
                        {restoringId === order._id ? "Restoring…" : "Restore"}
                      </button>
                    ) : null
                  }
                  fields={
                    <>
                      <DataField
                        label="Date"
                        value={displayOrderDate(order)}
                      />
                      <DataField
                        label="Start"
                        value={
                          showingDeleted ? (
                            order.startTime || "—"
                          ) : (
                          <WindowTimeInput
                            label={`Start time for ${displayNumber(order)}`}
                            field="startTime"
                            order={order}
                            token={token}
                            onSaved={saveOrderTimes}
                          />
                          )
                        }
                      />
                      <DataField
                        label="End"
                        value={
                          showingDeleted ? (
                            order.endTime || "—"
                          ) : (
                          <WindowTimeInput
                            label={`End time for ${displayNumber(order)}`}
                            field="endTime"
                            order={order}
                            token={token}
                            onSaved={saveOrderTimes}
                          />
                          )
                        }
                      />
                      <DataField label="Total" value={formatMoney(order.total)} />
                    </>
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
                      Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Tech
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Start
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      End
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Status
                    </th>
                    {showingDeleted ? (
                      <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        <span className="sr-only">Actions</span>
                      </th>
                    ) : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {orders.map((order) => (
                    <tr
                      key={order._id}
                      className="cursor-pointer hover:bg-neutral-50"
                      onClick={() =>
                        router.push(`/dashboard/work-orders/detail?id=${order._id}`)
                      }
                    >
                      <td className="px-6 py-4 font-medium text-brand-dark">
                        {displayNumber(order)}
                        <div className="text-xs font-normal text-neutral-400">
                          {displayOrderDate(order)}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {order.customerName || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">{order.tech || "—"}</td>
                      <td className="px-6 py-4">
                        {showingDeleted ? (
                          <span className="text-neutral-600">
                            {order.startTime || "—"}
                          </span>
                        ) : (
                        <WindowTimeInput
                          label={`Start time for ${displayNumber(order)}`}
                          field="startTime"
                          order={order}
                          token={token}
                          onSaved={saveOrderTimes}
                        />
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {showingDeleted ? (
                          <span className="text-neutral-600">
                            {order.endTime || "—"}
                          </span>
                        ) : (
                        <WindowTimeInput
                          label={`End time for ${displayNumber(order)}`}
                          field="endTime"
                          order={order}
                          token={token}
                          onSaved={saveOrderTimes}
                        />
                        )}
                      </td>
                      <td className="px-6 py-4">{formatMoney(order.total)}</td>
                      <td className="px-6 py-4 text-neutral-600">
                        {order.completed ? "Completed" : "Open"}
                        {order.paid ? " · Paid" : ""}
                      </td>
                      {showingDeleted ? (
                        <td
                          className="px-6 py-4 text-right"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            disabled={restoringId === order._id}
                            onClick={() => void handleRestore(order._id)}
                            className="text-xs font-medium text-brand-orange hover:underline disabled:opacity-60"
                          >
                            {restoringId === order._id ? "Restoring…" : "Restore"}
                          </button>
                        </td>
                      ) : null}
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
