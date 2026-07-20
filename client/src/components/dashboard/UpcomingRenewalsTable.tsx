"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpDown,
} from "lucide-react";
import { useAuthStore } from "@/store/useAuthStore";
import { getContracts, ContractListItem, ApiError } from "@/lib/api";
import {
  STANDING_LABELS,
  STANDING_STYLES,
  type ContractStanding,
} from "@/lib/contractDates";
import { formatContractCatalogLabel } from "@/lib/contractTypes";
import {
  formatCustomerName,
  formatCustomerState,
  toProperCase,
} from "@/lib/formatName";
import LucideIconByName from "@/components/icons/LucideIconByName";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 200] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type SortKey =
  | "customer"
  | "phone"
  | "street"
  | "city"
  | "state"
  | "zip"
  | "contractType"
  | "renewalDue"
  | "status";

type SortDir = "asc" | "desc";

function formatPhone(phone: string | undefined | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function sortValue(contract: ContractListItem, key: SortKey): string | number {
  const customer = contract.customer;
  switch (key) {
    case "customer":
      return customer
        ? `${customer.last} ${customer.first}`.toLowerCase()
        : `customer #${contract.customerId}`;
    case "phone":
      return (customer?.phone ?? "").replace(/\D/g, "") || "";
    case "street":
      return (customer?.address ?? "").toLowerCase();
    case "city":
      return (customer?.city ?? "").toLowerCase();
    case "state":
      return (customer?.state ?? "").toLowerCase();
    case "zip":
      return (customer?.zip ?? "").toLowerCase();
    case "contractType":
      return formatContractCatalogLabel(contract).toLowerCase();
    case "renewalDue":
      return contract.renewalDueDate
        ? new Date(contract.renewalDueDate).getTime()
        : Number.POSITIVE_INFINITY;
    case "status":
      return contract.standing;
    default:
      return "";
  }
}

function compareRenewals(
  a: ContractListItem,
  b: ContractListItem,
  key: SortKey,
  dir: SortDir,
): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") {
    cmp = av - bv;
  } else {
    cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
  }
  return dir === "asc" ? cmp : -cmp;
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

function StandingBadge({ standing }: { standing: ContractStanding }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${STANDING_STYLES[standing]}`}
    >
      {STANDING_LABELS[standing]}
    </span>
  );
}

function RenewalsPagination({
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
        Showing {rangeStart}–{rangeEnd} of {total}
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

export default function UpcomingRenewalsTable() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const now = new Date();
  const currentYear = now.getFullYear();

  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [viewYear, setViewYear] = useState(currentYear);
  const [renewals, setRenewals] = useState<ContractListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [sortKey, setSortKey] = useState<SortKey>("renewalDue");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const yearOptions = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear - 5; y <= currentYear + 2; y++) {
      years.push(y);
    }
    if (!years.includes(viewYear)) {
      years.push(viewYear);
      years.sort((a, b) => a - b);
    }
    return years;
  }, [currentYear, viewYear]);

  const monthLabel = `${MONTH_NAMES[viewMonth]} ${viewYear}`;

  const sortedRenewals = useMemo(
    () => [...renewals].sort((a, b) => compareRenewals(a, b, sortKey, sortDir)),
    [renewals, sortKey, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(sortedRenewals.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pagedRenewals = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedRenewals.slice(start, start + pageSize);
  }, [sortedRenewals, safePage, pageSize]);

  const rangeStart =
    sortedRenewals.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, sortedRenewals.length);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function goToPrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
    setPage(1);
  }

  function goToNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
    setPage(1);
  }

  function handleYearChange(year: number) {
    setViewYear(year);
    setPage(1);
  }

  useEffect(() => {
    if (!token) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);

    getContracts(token, undefined, {
      year: viewYear,
      month: viewMonth + 1,
    })
      .then(({ contracts }) => setRenewals(contracts))
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load upcoming renewals.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, viewMonth, viewYear]);

  return (
    <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
      <div className="px-6 py-4 border-b border-neutral-100">
        <div>
          <h2 className="text-base font-semibold text-brand-dark">
            Upcoming Renewals
          </h2>
          <p className="mt-0.5 text-xs text-neutral-500">
            Service contracts with renewal due in this month
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={goToPrevMonth}
            aria-label="Previous month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 text-brand-dark transition-colors hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[8.5rem] text-center text-sm font-medium text-brand-dark">
            {MONTH_NAMES[viewMonth]}
          </span>
          <button
            type="button"
            onClick={goToNextMonth}
            aria-label="Next month"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 text-brand-dark transition-colors hover:bg-neutral-50"
          >
            <ArrowRight className="h-4 w-4" />
          </button>
          <label className="sr-only" htmlFor="renewals-year">
            Year
          </label>
          <select
            id="renewals-year"
            value={viewYear}
            onChange={(e) => handleYearChange(Number(e.target.value))}
            className="rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="px-6 py-10 text-sm text-neutral-500">
          Loading renewals…
        </div>
      ) : error ? (
        <div className="px-6 py-4 text-sm text-red-700">{error}</div>
      ) : (
        <>
          {sortedRenewals.length > 0 && (
            <RenewalsPagination
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              total={sortedRenewals.length}
              pageSize={pageSize}
              safePage={safePage}
              totalPages={totalPages}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              position="top"
            />
          )}

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
                  <SortHeader
                    label="Contract Type"
                    column="contractType"
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={handleSort}
                  />
                  <SortHeader
                    label="Renewal Due"
                    column="renewalDue"
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
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 bg-white">
                {sortedRenewals.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-6 py-12 text-center text-neutral-500"
                    >
                      No renewals due in {monthLabel}.
                    </td>
                  </tr>
                ) : (
                  pagedRenewals.map((contract) => (
                    <tr
                      key={contract._id}
                      onClick={() =>
                        contract.customer &&
                        router.push(
                          `/dashboard/customers/detail?id=${contract.customer._id}`,
                        )
                      }
                      className="cursor-pointer transition-colors hover:bg-neutral-50"
                    >
                      <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                        {contract.customer
                          ? formatCustomerName(
                              contract.customer.first,
                              contract.customer.last,
                            )
                          : `Customer #${contract.customerId}`}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {formatPhone(contract.customer?.phone)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {contract.customer?.address
                          ? toProperCase(contract.customer.address)
                          : "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {contract.customer?.city
                          ? toProperCase(contract.customer.city)
                          : "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {formatCustomerState(contract.customer?.state)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {contract.customer?.zip?.trim() || "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          {contract.template?.badgeIcon ? (
                            <LucideIconByName
                              name={contract.template.badgeIcon}
                              className="h-3.5 w-3.5 text-neutral-500"
                              size={14}
                            />
                          ) : null}
                          {formatContractCatalogLabel(contract)}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                        {contract.renewalDueDate
                          ? new Date(
                              contract.renewalDueDate,
                            ).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <StandingBadge
                          standing={contract.standing ?? "expired"}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {sortedRenewals.length > 0 && (
            <RenewalsPagination
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              total={sortedRenewals.length}
              pageSize={pageSize}
              safePage={safePage}
              totalPages={totalPages}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
              onPrev={() => setPage((p) => Math.max(1, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              position="bottom"
            />
          )}
        </>
      )}
    </div>
  );
}
