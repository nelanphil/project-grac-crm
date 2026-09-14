"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, FileText, Plus, Search } from "lucide-react";
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
  EstimateItem,
  EstimateStatusGroup,
  getEstimates,
} from "@/lib/api";
import {
  DEFAULT_PAGE_SIZE,
  paginationRange,
  type PageSize,
} from "@/lib/pagination";

type EstimateFilter = EstimateStatusGroup | "all";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

export default function EstimatesPage() {
  return (
    <AuthGuard>
      <EstimatesContent />
    </AuthGuard>
  );
}

function EstimatesContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const canWrite = useAuthStore((s) => s.hasPermission("estimates:write"));
  const [estimates, setEstimates] = useState<EstimateItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [statusGroup, setStatusGroup] = useState<EstimateFilter>("all");
  const [stats, setStats] = useState({
    total: 0,
    active: 0,
    awarded: 0,
    lost: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);

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
    getEstimates(token, {
      page,
      pageSize,
      search: debounced || undefined,
      statusGroup: statusGroup === "all" ? undefined : statusGroup,
    })
      .then((res) => {
        setEstimates(res.estimates);
        setTotal(res.total);
        if (res.stats) {
          setStats(res.stats);
          setStatsLoading(false);
        }
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load estimates."),
      )
      .finally(() => setLoading(false));
  }, [token, page, pageSize, debounced, statusGroup]);

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

  const value = (n: number) => (statsLoading ? "—" : String(n));
  const statItems: FilterStatItem<EstimateFilter>[] = [
    { label: "Total", value: value(stats.total), tone: "neutral", filter: "all" },
    { label: "Active", value: value(stats.active), tone: "success", filter: "active" },
    { label: "Awarded", value: value(stats.awarded), tone: "info", filter: "awarded" },
    { label: "Lost", value: value(stats.lost), tone: "danger", filter: "lost" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Estimates</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Quotes that can be converted into work orders.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/estimates/templates"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Copy className="h-4 w-4" />
            Templates
          </Link>
          {canWrite ? (
            <Link
              href="/dashboard/estimates/create"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              New estimate
            </Link>
          ) : null}
        </div>
      </div>

      <FilterStatsCards
        title="Estimate stats"
        icon={FileText}
        items={statItems}
        selected={statusGroup}
        onSelect={(filter) => {
          setStatusGroup(filter);
          setPage(1);
        }}
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number or customer"
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
          Loading estimates…
        </div>
      ) : (
        <ResponsiveDataView
          isEmpty={estimates.length === 0}
          empty={
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
              <FileText className="mb-4 h-10 w-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">No estimates yet</p>
              {canWrite ? (
                <Link
                  href="/dashboard/estimates/create"
                  className="mt-4 text-sm font-medium text-brand-orange hover:underline"
                >
                  Create an estimate
                </Link>
              ) : null}
            </div>
          }
          mobile={
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="top" />
              </div>
              {estimates.map((estimate) => (
                <MobileDataCard
                  key={estimate._id}
                  title={estimate.number}
                  subtitle={estimate.customerName || "—"}
                  onClick={() =>
                    router.push(`/dashboard/estimates/detail?id=${estimate._id}`)
                  }
                  badges={
                    <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-xs capitalize">
                      {estimate.status}
                    </span>
                  }
                  fields={
                    <>
                      <DataField
                        label="Date"
                        value={
                          estimate.date
                            ? new Date(estimate.date).toLocaleDateString()
                            : "—"
                        }
                      />
                      <DataField label="Total" value={formatMoney(estimate.total)} />
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
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {estimates.map((estimate) => (
                    <tr
                      key={estimate._id}
                      className="cursor-pointer hover:bg-neutral-50"
                      onClick={() =>
                        router.push(`/dashboard/estimates/detail?id=${estimate._id}`)
                      }
                    >
                      <td className="px-6 py-4 font-medium text-brand-dark">
                        {estimate.number}
                        <div className="text-xs font-normal text-neutral-400">
                          {estimate.date
                            ? new Date(estimate.date).toLocaleDateString()
                            : "—"}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {estimate.customerName || "—"}
                      </td>
                      <td className="px-6 py-4 capitalize text-neutral-600">
                        {estimate.status}
                      </td>
                      <td className="px-6 py-4">{formatMoney(estimate.total)}</td>
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
