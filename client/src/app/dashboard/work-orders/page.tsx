"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, Search } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, getWorkOrders, WorkOrderListItem } from "@/lib/api";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

function displayNumber(order: WorkOrderListItem): string {
  return order.number || (order.legacyId ? String(order.legacyId) : order._id.slice(-6));
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
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));
  const [orders, setOrders] = useState<WorkOrderListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<"all" | "open" | "completed" | "unpaid">("all");

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
      pageSize: 50,
      search: debounced || undefined,
      completed: status === "completed" ? true : status === "open" ? false : undefined,
      paid: status === "unpaid" ? false : undefined,
    })
      .then((res) => {
        setOrders(res.workOrders);
        setTotal(res.total);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load work orders."),
      )
      .finally(() => setLoading(false));
  }, [token, page, debounced, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Work orders</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Service tickets, labor, and parts used to generate invoices.
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/dashboard/work-orders/create"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            New work order
          </Link>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search number, customer, or technician"
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
          className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm"
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="completed">Completed</option>
          <option value="unpaid">Unpaid</option>
        </select>
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
              <p className="text-sm font-medium text-neutral-500">No work orders yet</p>
            </div>
          }
          mobile={orders.map((order) => (
            <MobileDataCard
              key={order._id}
              title={displayNumber(order)}
              subtitle={order.customerName || "—"}
              onClick={() =>
                router.push(`/dashboard/work-orders/detail?id=${order._id}`)
              }
              fields={
                <>
                  <DataField
                    label="Date"
                    value={
                      order.date
                        ? new Date(order.date).toLocaleDateString()
                        : "—"
                    }
                  />
                  <DataField label="Total" value={formatMoney(order.total)} />
                </>
              }
            />
          ))}
          desktop={
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
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
                      Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Status
                    </th>
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
                          {order.date
                            ? new Date(order.date).toLocaleDateString()
                            : "—"}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {order.customerName || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">{order.tech || "—"}</td>
                      <td className="px-6 py-4">{formatMoney(order.total)}</td>
                      <td className="px-6 py-4 text-neutral-600">
                        {order.completed ? "Completed" : "Open"}
                        {order.paid ? " · Paid" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {total > 50 ? (
                <div className="flex justify-end gap-2 border-t border-neutral-100 px-4 py-3">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                    className="rounded-md border px-3 py-1 text-xs disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page * 50 >= total}
                    onClick={() => setPage((p) => p + 1)}
                    className="rounded-md border px-3 py-1 text-xs disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </div>
          }
        />
      )}
    </div>
  );
}
