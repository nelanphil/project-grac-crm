"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import AuthGuard from "@/components/auth/AuthGuard";
import { useAuthStore } from "@/store/useAuthStore";
import { ApiError, FinancialsSummary, getFinancialsSummary } from "@/lib/api";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format((cents || 0) / 100);
}

type Period = "month" | "last-month" | "ytd" | "all";

function periodBounds(period: Period): { from?: string; to?: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  if (period === "all") return {};
  if (period === "ytd") {
    return { from: new Date(Date.UTC(y, 0, 1)).toISOString() };
  }
  if (period === "month") {
    return { from: new Date(Date.UTC(y, m, 1)).toISOString() };
  }
  const last = m === 0 ? 11 : m - 1;
  const lastYear = m === 0 ? y - 1 : y;
  return {
    from: new Date(Date.UTC(lastYear, last, 1)).toISOString(),
    to: new Date(Date.UTC(y, m, 1)).toISOString(),
  };
}

function Kpi({
  label,
  value,
  hint,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="block rounded-2xl border border-[var(--staff-border)] bg-white px-4 py-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-bold text-brand-dark">{value}</p>
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </Link>
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
  const token = useAuthStore((s) => s.token);
  const canRead = useAuthStore((s) => s.hasPermission("reports:read"));
  const [period, setPeriod] = useState<Period>("month");
  const [summary, setSummary] = useState<FinancialsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bounds = useMemo(() => periodBounds(period), [period]);

  useEffect(() => {
    if (!token || !canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    getFinancialsSummary(token, bounds)
      .then(setSummary)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load financials."),
      )
      .finally(() => setLoading(false));
  }, [token, canRead, bounds]);

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

  const estimateStatuses = summary?.estimates.byStatus ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Financials</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Billing activity across invoices, work orders, and estimates.
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
              onClick={() => setPeriod(id)}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                period === id
                  ? "bg-brand-dark text-white"
                  : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading || !summary ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading financials…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Invoiced"
              value={formatMoney(summary.invoices.invoicedCents)}
              hint={`${summary.invoices.count} invoices`}
              href="/dashboard/orders"
            />
            <Kpi
              label="Paid"
              value={formatMoney(summary.invoices.paidCents)}
              hint={`${summary.invoices.paidCount} paid`}
              href="/dashboard/orders"
            />
            <Kpi
              label="Outstanding"
              value={formatMoney(summary.invoices.outstandingCents)}
              hint={`${summary.invoices.openCount} open`}
              href="/dashboard/orders"
            />
            <Kpi
              label="Past due"
              value={formatMoney(summary.invoices.pastDueCents)}
              href="/dashboard/orders"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="Open work orders"
              value={String(summary.workOrders.openCount)}
              hint={`${summary.workOrders.completedCount} completed`}
              href="/dashboard/work-orders"
            />
            <Kpi
              label="Unbilled work"
              value={formatMoney(summary.workOrders.unbilledCents)}
              href="/dashboard/work-orders"
            />
            <Kpi
              label="Labor hours"
              value={summary.workOrders.laborHours.toFixed(1)}
              href="/dashboard/work-orders"
            />
            <Kpi
              label="Estimates"
              value={String(summary.estimates.count)}
              href="/dashboard/estimates"
            />
          </div>

          <div className="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-brand-dark">Estimate pipeline</h2>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase text-neutral-500">
                    <th className="py-2">Status</th>
                    <th className="py-2">Count</th>
                    <th className="py-2">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(estimateStatuses).map(([status, row]) => (
                    <tr key={status} className="border-t border-neutral-100">
                      <td className="py-2 capitalize">{status}</td>
                      <td className="py-2">{row.count}</td>
                      <td className="py-2">{formatMoney(row.cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
