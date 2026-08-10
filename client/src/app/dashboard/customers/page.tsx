"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import LucideIconByName from "@/components/icons/LucideIconByName";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getCustomers,
  softDeleteCustomer,
  restoreCustomer,
  CustomerListItem,
  CustomerContractBadge,
  ApiError,
} from "@/lib/api";
import { STANDING_STYLES } from "@/lib/contractDates";
import { formatContractType } from "@/lib/contractTypes";
import {
  formatCustomerRecordName,
  formatCustomerState,
  toProperCase,
} from "@/lib/formatName";

const PAGE_SIZE_OPTIONS = [25, 50, 150, 250, 500] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type SortKey = "customer" | "phone" | "street" | "city" | "state" | "zip";
type SortDir = "asc" | "desc";
type ListView = "active" | "deleted";

function formatPhone(phone: string): string {
  if (!phone) return "\u2014";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function CustomerContractBadges({
  contracts,
}: {
  contracts: CustomerContractBadge[];
}) {
  if (contracts.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {contracts.map((contract) => {
        const standing = contract.standing ?? "expired";
        const isActive = standing === "active";
        const label =
          contract.template?.label || formatContractType(contract.contractType);
        const icon = contract.template?.badgeIcon ?? "scroll-text";

        return (
          <span
            key={contract._id}
            title={`${label} Â· ${standing.replace("_", " ")}`}
            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border ${
              isActive
                ? STANDING_STYLES.active
                : standing === "due_soon"
                  ? STANDING_STYLES.due_soon
                  : "border-neutral-200 bg-neutral-50 text-neutral-500"
            }`}
          >
            <LucideIconByName name={icon} className="h-3 w-3" size={12} />
          </span>
        );
      })}
    </span>
  );
}

function CustomerMobileCard({
  customer,
  isDeleted,
  canManageCustomers,
  canReadContracts,
  deletingId,
  restoringId,
  onOpen,
  onRestore,
  onDelete,
}: {
  customer: CustomerListItem;
  isDeleted: boolean;
  canManageCustomers: boolean;
  canReadContracts: boolean;
  deletingId: string | null;
  restoringId: string | null;
  onOpen: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const ownerLabel = customer.owner
    ? `${customer.owner.first_name} ${customer.owner.last_name}`.trim()
    : "\u2014";

  return (
    <MobileDataCard
      title={formatCustomerRecordName(customer)}
      subtitle={formatPhone(customer.phone)}
      onClick={isDeleted ? undefined : onOpen}
      badges={
        <>
          {isDeleted ? (
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 ring-1 ring-inset ring-neutral-300">
              Deleted
            </span>
          ) : null}
          {!isDeleted && (customer.duplicateCount ?? 0) > 0 ? (
            <span
              className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-600/20"
              title={`${customer.duplicateCount} other customer(s) share this phone`}
            >
              Possible duplicate
            </span>
          ) : null}
          {!isDeleted && canReadContracts ? (
            <CustomerContractBadges contracts={customer.contracts ?? []} />
          ) : null}
        </>
      }
      fields={
        <>
          <DataField
            label="Street"
            value={
              customer.address ? toProperCase(customer.address) : "\u2014"
            }
            className="col-span-2"
          />
          <DataField
            label="City"
            value={customer.city ? toProperCase(customer.city) : "\u2014"}
          />
          <DataField label="State" value={formatCustomerState(customer.state)} />
          <DataField
            label="Zip"
            value={customer.zip?.trim() || "\u2014"}
          />
          <DataField
            label="County"
            value={customer.county?.trim() || "\u2014"}
          />
          <DataField label="Owner" value={ownerLabel} className="col-span-2" />
        </>
      }
      actions={
        canManageCustomers ? (
          isDeleted ? (
            <button
              type="button"
              disabled={restoringId === customer._id}
              onClick={onRestore}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs font-medium text-brand-orange hover:border-brand-orange disabled:opacity-60"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {restoringId === customer._id ? "Restoring\u2026" : "Restore"}
            </button>
          ) : (
            <button
              type="button"
              disabled={deletingId === customer._id}
              onClick={onDelete}
              className="inline-flex items-center justify-center rounded-lg border border-neutral-200 p-2 text-red-600 hover:border-red-200 hover:bg-red-50 disabled:opacity-60"
              title="Delete customer"
              aria-label="Delete customer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )
        ) : null
      }
    />
  );
}

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

function CustomersPagination({
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

function CustomersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q")?.trim() ?? "";
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canManageCustomers = useAuthStore((s) =>
    s.hasRole("admin", "super-admin", "owner"),
  );
  const canReadContracts = useAuthStore((s) =>
    s.hasPermission("contracts:read"),
  );

  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(initialQuery);
  const [debouncedSearch, setDebouncedSearch] = useState(initialQuery);
  const [listView, setListView] = useState<ListView>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [sortKey, setSortKey] = useState<SortKey>("customer");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [refreshKey, setRefreshKey] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);

  const rangeStart = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, total);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  useEffect(() => {
    if (user?.role === "customer") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  useEffect(() => {
    const q = searchParams.get("q")?.trim() ?? "";
    if (q && q !== search) {
      // Seed from URL only when the query param changes.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearch(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

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

    const deletedOnly = canManageCustomers && listView === "deleted";

    getCustomers(token, {
      deletedOnly,
      page,
      pageSize,
      search: debouncedSearch,
      sortKey,
      sortDir,
    })
      .then(({ customers: list, total: totalCount }) => {
        if (cancelled) return;
        setCustomers(list);
        setTotal(totalCount);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load customers.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    token,
    user,
    canManageCustomers,
    listView,
    page,
    pageSize,
    sortKey,
    sortDir,
    debouncedSearch,
    refreshKey,
  ]);

  async function handleSoftDelete(customer: CustomerListItem) {
    if (!token) return;
    const name = formatCustomerRecordName(customer) || "this customer";
    if (
      !window.confirm(
        `Soft-delete ${name}? They can be restored from the Deleted view.`,
      )
    ) {
      return;
    }

    setDeletingId(customer._id);
    setActionError(null);
    try {
      await softDeleteCustomer(token, customer._id);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to delete customer.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  async function handleRestore(customer: CustomerListItem) {
    if (!token) return;
    setRestoringId(customer._id);
    setActionError(null);
    try {
      await restoreCustomer(token, customer._id);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to restore customer.",
      );
    } finally {
      setRestoringId(null);
    }
  }

  if (!user || user.role === "customer") return null;

  if (loading && customers.length === 0)
    return (
      <div className="flex items-center gap-1 text-sm text-neutral-500 py-6">
        <span>Loading customers</span>
        <span className="inline-flex">
          <span className="animate-bounce [animation-delay:-0.3s]">.</span>
          <span className="animate-bounce [animation-delay:-0.15s]">.</span>
          <span className="animate-bounce">.</span>
        </span>
      </div>
    );
  if (error) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  const showingDeleted = canManageCustomers && listView === "deleted";

  const emptyMessage = debouncedSearch
    ? "No customers match your search."
    : showingDeleted
      ? "No deleted customers."
      : "No customers found.";

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
          <h1 className="text-2xl font-bold text-brand-dark">Customers</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {debouncedSearch
              ? `${total} ${showingDeleted ? "deleted " : ""}match${total === 1 ? "" : "es"}`
              : `${total} ${showingDeleted ? "deleted" : "total"}`}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:w-auto lg:justify-end">
          <div className="relative w-full sm:min-w-[16rem] sm:flex-1 lg:w-72 lg:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder="Search by name, location, or phone\u2026"
              className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-orange"
            />
          </div>
          {canManageCustomers ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <div className="inline-flex shrink-0 rounded-lg border border-neutral-200 bg-white p-0.5 text-sm">
                <button
                  type="button"
                  onClick={() => {
                    setListView("active");
                    setPage(1);
                    setActionError(null);
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
                    setListView("deleted");
                    setPage(1);
                    setActionError(null);
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
              <Link
                href="/dashboard/customers/create?returnTo=/dashboard/customers"
                className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90 sm:flex-none"
              >
                <Plus className="h-4 w-4" />
                Add Customer
              </Link>
            </div>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <div className="space-y-3">
        {total > 0 ? (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm md:hidden">
            <CustomersPagination {...paginationProps} position="top" />
          </div>
        ) : null}

        <ResponsiveDataView
          isEmpty={customers.length === 0}
          empty={
            <div className="rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center text-sm text-neutral-500 shadow-sm">
              {emptyMessage}
            </div>
          }
          mobile={customers.map((customer) => {
            const isDeleted = showingDeleted;
            return (
              <CustomerMobileCard
                key={customer._id}
                customer={customer}
                isDeleted={isDeleted}
                canManageCustomers={canManageCustomers}
                canReadContracts={canReadContracts}
                deletingId={deletingId}
                restoringId={restoringId}
                onOpen={() =>
                  router.push(
                    `/dashboard/customers/detail?id=${customer._id}`,
                  )
                }
                onRestore={() => {
                  void handleRestore(customer);
                }}
                onDelete={() => {
                  void handleSoftDelete(customer);
                }}
              />
            );
          })}
          desktop={
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              {total > 0 ? (
                <CustomersPagination {...paginationProps} position="top" />
              ) : null}

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-neutral-100 text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <SortHeader
                        label="Customer"
                        column="customer"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        label="Phone"
                        column="phone"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        label="Street"
                        column="street"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        label="City"
                        column="city"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        label="State"
                        column="state"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <SortHeader
                        label="Zip"
                        column="zip"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        County
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                        Owner
                      </th>
                      {canManageCustomers ? (
                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                          Actions
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 bg-white">
                    {customers.map((customer) => {
                      const isDeleted = showingDeleted;
                      return (
                        <tr
                          key={customer._id}
                          onClick={() => {
                            if (isDeleted) return;
                            router.push(
                              `/dashboard/customers/detail?id=${customer._id}`,
                            );
                          }}
                          className={`transition-colors ${
                            isDeleted
                              ? "bg-neutral-50/80"
                              : "cursor-pointer hover:bg-neutral-50"
                          }`}
                        >
                          <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                            <span className="inline-flex items-center gap-2">
                              {formatCustomerRecordName(customer)}
                              {isDeleted ? (
                                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600 ring-1 ring-inset ring-neutral-300">
                                  Deleted
                                </span>
                              ) : null}
                              {!isDeleted &&
                              (customer.duplicateCount ?? 0) > 0 ? (
                                <span
                                  className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-600/20"
                                  title={`${customer.duplicateCount} other customer(s) share this phone`}
                                >
                                  Possible duplicate
                                </span>
                              ) : null}
                              {!isDeleted && canReadContracts ? (
                                <CustomerContractBadges
                                  contracts={customer.contracts ?? []}
                                />
                              ) : null}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                            {formatPhone(customer.phone)}
                          </td>
                          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                            {customer.address
                              ? toProperCase(customer.address)
                              : "\u2014"}
                          </td>
                          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                            {customer.city
                              ? toProperCase(customer.city)
                              : "\u2014"}
                          </td>
                          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                            {formatCustomerState(customer.state)}
                          </td>
                          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                            {customer.zip?.trim() || "\u2014"}
                          </td>
                          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                            {customer.county?.trim() || "\u2014"}
                          </td>
                          <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                            {customer.owner
                              ? `${customer.owner.first_name} ${customer.owner.last_name}`.trim()
                              : "\u2014"}
                          </td>
                          {canManageCustomers ? (
                            <td className="px-6 py-4 text-right whitespace-nowrap">
                              {isDeleted ? (
                                <button
                                  type="button"
                                  disabled={restoringId === customer._id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleRestore(customer);
                                  }}
                                  className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-orange hover:underline disabled:opacity-60"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  {restoringId === customer._id
                                    ? "Restoring\u2026"
                                    : "Restore"}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={deletingId === customer._id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleSoftDelete(customer);
                                  }}
                                  className="inline-flex items-center justify-center rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-60"
                                  title="Delete customer"
                                  aria-label="Delete customer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {total > 0 ? (
                <CustomersPagination {...paginationProps} position="bottom" />
              ) : null}
            </div>
          }
        />

        {total > 0 ? (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm md:hidden">
            <CustomersPagination {...paginationProps} position="bottom" />
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
            Loading customers…
          </div>
        }
      >
        <CustomersContent />
      </Suspense>
    </AuthGuard>
  );
}
