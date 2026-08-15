"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Trash2 } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getLeads,
  updateLeadStatus,
  convertLead,
  deleteLead,
  ApiError,
} from "@/lib/api";
import type { LeadListItem, LeadStatus } from "@/lib/lead-types";

const PAGE_SIZE_OPTIONS = [25, 50, 150, 250, 500] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const STATUS_OPTIONS: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "lost",
  "won",
];

function formatPhone(phone: string): string {
  if (!phone) return "\u2014";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function formatAddress(lead: LeadListItem): string {
  const parts = [lead.addressLine1, lead.city, lead.state, lead.zipCode]
    .map((p) => p?.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "\u2014";
}

function LeadsPagination({
  rangeStart,
  rangeEnd,
  total,
  pageSize,
  safePage,
  totalPages,
  onPageSizeChange,
  onPrev,
  onNext,
  position,
}: {
  rangeStart: number;
  rangeEnd: number;
  total: number;
  pageSize: PageSize;
  safePage: number;
  totalPages: number;
  onPageSizeChange: (size: PageSize) => void;
  onPrev: () => void;
  onNext: () => void;
  position: "top" | "bottom";
}) {
  return (
    <div
      className={`flex flex-col gap-3 px-6 py-3 sm:flex-row sm:items-center sm:justify-between ${
        position === "top"
          ? "border-b border-neutral-100"
          : "border-t border-neutral-100"
      }`}
    >
      <p className="text-xs text-neutral-500">
        Showing {rangeStart}&ndash;{rangeEnd} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          Rows
          <select
            value={pageSize}
            onChange={(e) =>
              onPageSizeChange(Number(e.target.value) as PageSize)
            }
            className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={onPrev}
            className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-brand-dark transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <span className="px-2 text-xs text-neutral-500">
            Page {safePage} of {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={onNext}
            className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs font-medium text-brand-dark transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q")?.trim() ?? "";
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canWrite = useAuthStore((s) => s.hasPermission("leads:write"));
  const canDelete = useAuthStore((s) => s.hasPermission("leads:delete"));

  const [leads, setLeads] = useState<LeadListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(initialQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(initialQuery);
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [convertMessage, setConvertMessage] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, total);

  useEffect(() => {
    if (user?.role === "customer") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!token || user?.role === "customer") return;

    let cancelled = false;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    getLeads(token, {
      page,
      pageSize,
      search: debouncedSearch,
      status: status || undefined,
    })
      .then(({ leads: list, total: totalCount }) => {
        if (cancelled) return;
        setLeads(list);
        setTotal(totalCount);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load leads.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user, page, pageSize, debouncedSearch, status, refreshKey]);

  async function handleStatusChange(lead: LeadListItem, next: LeadStatus) {
    if (!token) return;
    setBusyId(lead.id);
    setActionError(null);
    try {
      await updateLeadStatus(token, lead.id, next);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to update lead status.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleConvert(lead: LeadListItem) {
    if (!token) return;
    setBusyId(lead.id);
    setActionError(null);
    setConvertMessage(null);
    try {
      const result = await convertLead(token, lead.id);
      setConvertMessage(
        result.matchedExisting
          ? "Linked to an existing customer."
          : "Created a new temporary customer.",
      );
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to convert lead.",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(lead: LeadListItem) {
    if (!token) return;
    if (
      !window.confirm(
        `Delete lead from ${lead.firstName} ${lead.lastName}? This cannot be undone from this page.`,
      )
    ) {
      return;
    }
    setBusyId(lead.id);
    setActionError(null);
    try {
      await deleteLead(token, lead.id);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to delete lead.",
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!user || user.role === "customer") return null;

  if (loading && leads.length === 0) {
    return (
      <div className="flex items-center gap-1 text-sm text-neutral-500 py-6">
        <span>Loading leads</span>
        <span className="inline-flex">
          <span className="animate-bounce [animation-delay:-0.3s]">.</span>
          <span className="animate-bounce [animation-delay:-0.15s]">.</span>
          <span className="animate-bounce">.</span>
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  const emptyMessage = debouncedSearch
    ? "No leads match your search."
    : "No leads yet.";

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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Leads</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {debouncedSearch
              ? `${total} match${total === 1 ? "" : "es"}`
              : `${total} total`}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
          <div className="relative w-full sm:min-w-[16rem] sm:flex-1 lg:w-72 lg:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or phone…"
              className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-orange"
            />
          </div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as LeadStatus | "");
              setPage(1);
            }}
            className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-brand-dark outline-none focus:border-brand-orange"
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}
      {convertMessage ? (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {convertMessage}
        </div>
      ) : null}

      <div className="space-y-3">
        {total > 0 ? (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm md:hidden">
            <LeadsPagination {...paginationProps} position="top" />
          </div>
        ) : null}

        <ResponsiveDataView
          isEmpty={leads.length === 0}
          empty={
            <div className="rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center text-sm text-neutral-500 shadow-sm">
              {emptyMessage}
            </div>
          }
          mobile={leads.map((lead) => (
            <MobileDataCard
              key={lead.id}
              title={`${lead.firstName} ${lead.lastName}`.trim()}
              subtitle={formatPhone(lead.phone)}
              fields={
                <div className="grid grid-cols-2 gap-3">
                  <DataField label="Email" value={lead.email} />
                  <DataField label="Address" value={formatAddress(lead)} />
                  <DataField label="Status" value={lead.status} />
                  <DataField
                    label="Customer"
                    value={
                      lead.customerRef ? (
                        <Link
                          href={`/dashboard/customers/detail?id=${lead.customerRef}`}
                          className="text-brand-orange hover:underline"
                        >
                          View customer
                        </Link>
                      ) : (
                        "\u2014"
                      )
                    }
                  />
                </div>
              }
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  {canWrite ? (
                    <select
                      value={lead.status}
                      disabled={busyId === lead.id}
                      onChange={(e) =>
                        handleStatusChange(lead, e.target.value as LeadStatus)
                      }
                      className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-brand-dark"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  {canWrite && !lead.customerRef ? (
                    <button
                      type="button"
                      disabled={busyId === lead.id}
                      onClick={() => handleConvert(lead)}
                      className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange disabled:opacity-60"
                    >
                      Convert to Customer
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      disabled={busyId === lead.id}
                      onClick={() => handleDelete(lead)}
                      className="inline-flex items-center justify-center rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-60"
                      aria-label="Delete lead"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>
              }
            />
          ))}
          desktop={
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              {total > 0 ? (
                <LeadsPagination {...paginationProps} position="top" />
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-100 text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Email
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Phone
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Address
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Status
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 bg-white">
                    {leads.map((lead) => (
                      <tr
                        key={lead.id}
                        className="transition-colors hover:bg-neutral-50"
                      >
                        <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                          {`${lead.firstName} ${lead.lastName}`.trim()}
                        </td>
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          {lead.email}
                        </td>
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          {formatPhone(lead.phone)}
                        </td>
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          {formatAddress(lead)}
                        </td>
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          {canWrite ? (
                            <select
                              value={lead.status}
                              disabled={busyId === lead.id}
                              onChange={(e) =>
                                handleStatusChange(
                                  lead,
                                  e.target.value as LeadStatus,
                                )
                              }
                              className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-brand-dark"
                            >
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                          ) : (
                            lead.status
                          )}
                        </td>
                        <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                          {lead.customerRef ? (
                            <Link
                              href={`/dashboard/customers/detail?id=${lead.customerRef}`}
                              className="text-brand-orange hover:underline"
                            >
                              View customer
                            </Link>
                          ) : (
                            "\u2014"
                          )}
                        </td>
                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {canWrite && !lead.customerRef ? (
                              <button
                                type="button"
                                disabled={busyId === lead.id}
                                onClick={() => handleConvert(lead)}
                                className="rounded-md border border-neutral-300 px-2 py-1 text-xs font-medium text-brand-dark hover:border-brand-orange hover:text-brand-orange disabled:opacity-60"
                              >
                                Convert to Customer
                              </button>
                            ) : null}
                            {canDelete ? (
                              <button
                                type="button"
                                disabled={busyId === lead.id}
                                onClick={() => handleDelete(lead)}
                                className="inline-flex items-center justify-center rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-60"
                                title="Delete lead"
                                aria-label="Delete lead"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {total > 0 ? (
                <LeadsPagination {...paginationProps} position="bottom" />
              ) : null}
            </div>
          }
        />

        {total > 0 ? (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm md:hidden">
            <LeadsPagination {...paginationProps} position="bottom" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function LeadsPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
            Loading leads…
          </div>
        }
      >
        <LeadsContent />
      </Suspense>
    </AuthGuard>
  );
}
