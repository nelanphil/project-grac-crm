"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import LucideIconByName from "@/components/icons/LucideIconByName";
import { useAuthStore } from "@/store/useAuthStore";
import {
  getCustomers,
  getContracts,
  CustomerListItem,
  ContractListItem,
  ApiError,
} from "@/lib/api";
import { STANDING_STYLES } from "@/lib/contractDates";
import { formatContractCatalogLabel } from "@/lib/contractTypes";
import {
  formatCustomerName,
  formatCustomerState,
  toProperCase,
} from "@/lib/formatName";

const PAGE_SIZE_OPTIONS = [25, 50, 150, 250, 500] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type SortKey = "customer" | "phone" | "street" | "city" | "state" | "zip";
type SortDir = "asc" | "desc";

function formatPhone(phone: string): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

function matchesSearch(
  customer: CustomerListItem,
  query: string,
  contracts: ContractListItem[],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  const name = `${customer.first} ${customer.last}`.toLowerCase();
  const street = (customer.address ?? "").toLowerCase();
  const location = [customer.city, customer.state, customer.zip]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const phone = customer.phone.replace(/\D/g, "");
  const qDigits = q.replace(/\D/g, "");
  const contractMatch = contracts.some((c) =>
    formatContractCatalogLabel(c).toLowerCase().includes(q),
  );

  return (
    name.includes(q) ||
    street.includes(q) ||
    location.includes(q) ||
    customer.phone.toLowerCase().includes(q) ||
    (qDigits.length > 0 && phone.includes(qDigits)) ||
    contractMatch
  );
}

function normalizeSortText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function sortValue(customer: CustomerListItem, key: SortKey): string {
  switch (key) {
    case "customer":
      // Match displayed "First Last" order so A–Z tracks what users see.
      return [
        normalizeSortText(customer.first),
        normalizeSortText(customer.last),
      ]
        .filter(Boolean)
        .join(" ");
    case "phone":
      return customer.phone.replace(/\D/g, "") || "";
    case "street":
      return normalizeSortText(customer.address);
    case "city":
      return normalizeSortText(customer.city);
    case "state":
      return normalizeSortText(customer.state);
    case "zip":
      return normalizeSortText(customer.zip);
    default:
      return "";
  }
}

function compareCustomers(
  a: CustomerListItem,
  b: CustomerListItem,
  key: SortKey,
  dir: SortDir,
): number {
  const cmp = sortValue(a, key).localeCompare(sortValue(b, key), undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (cmp !== 0) return dir === "asc" ? cmp : -cmp;

  // Stable tie-breaker for identical primary keys (esp. same first name).
  if (key === "customer") {
    const byLast = normalizeSortText(a.last).localeCompare(
      normalizeSortText(b.last),
      undefined,
      { sensitivity: "base" },
    );
    if (byLast !== 0) return dir === "asc" ? byLast : -byLast;
  }

  return 0;
}

function CustomerContractBadges({
  contracts,
}: {
  contracts: ContractListItem[];
}) {
  if (contracts.length === 0) return null;

  return (
    <span className="inline-flex items-center gap-1">
      {contracts.map((contract) => {
        const standing = contract.standing ?? "expired";
        const isActive = standing === "active";
        const label = formatContractCatalogLabel(contract);
        const icon = contract.template?.badgeIcon ?? "scroll-text";

        return (
          <span
            key={contract._id}
            title={`${label} · ${standing.replace("_", " ")}`}
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

function CustomersContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);
  const canReadContracts = useAuthStore((s) =>
    s.hasPermission("contracts:read"),
  );

  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [contractsByCustomerId, setContractsByCustomerId] = useState<
    Map<number, ContractListItem[]>
  >(() => new Map());
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [sortKey, setSortKey] = useState<SortKey>("customer");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const filteredCustomers = useMemo(
    () =>
      customers.filter((c) =>
        matchesSearch(c, search, contractsByCustomerId.get(c.legacyId) ?? []),
      ),
    [customers, search, contractsByCustomerId],
  );

  const sortedCustomers = useMemo(
    () =>
      [...filteredCustomers].sort((a, b) =>
        compareCustomers(a, b, sortKey, sortDir),
      ),
    [filteredCustomers, sortKey, sortDir],
  );

  const totalPages = Math.max(1, Math.ceil(sortedCustomers.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const pagedCustomers = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return sortedCustomers.slice(start, start + pageSize);
  }, [sortedCustomers, safePage, pageSize]);

  const rangeStart =
    sortedCustomers.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const rangeEnd = Math.min(safePage * pageSize, sortedCustomers.length);

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
    if (!token || user?.role === "customer") return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    setError(null);

    const customersPromise = getCustomers(token);
    const contractsPromise = canReadContracts
      ? getContracts(token).catch(() => ({
          contracts: [] as ContractListItem[],
        }))
      : Promise.resolve({ contracts: [] as ContractListItem[] });

    Promise.all([customersPromise, contractsPromise])
      .then(([{ customers: list }, { contracts }]) => {
        setCustomers(list);

        const byCustomer = new Map<number, ContractListItem[]>();
        for (const contract of contracts) {
          const existing = byCustomer.get(contract.customerId) ?? [];
          existing.push(contract);
          byCustomer.set(contract.customerId, existing);
        }
        setContractsByCustomerId(byCustomer);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError ? err.message : "Failed to load customers.",
        ),
      )
      .finally(() => setLoading(false));
  }, [token, user, canReadContracts]);

  if (!user || user.role === "customer") return null;

  if (loading)
    return (
      <div className="text-sm text-neutral-500 py-6">Loading customers…</div>
    );
  if (error) {
    return (
      <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Customers</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {search.trim()
              ? `${sortedCustomers.length} of ${customers.length} customers`
              : `${customers.length} total`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search by name, location, or phone…"
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-orange"
          />
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        {sortedCustomers.length > 0 && (
          <CustomersPagination
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={sortedCustomers.length}
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
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {sortedCustomers.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-6 py-12 text-center text-neutral-500"
                  >
                    {search.trim()
                      ? "No customers match your search."
                      : "No customers found."}
                  </td>
                </tr>
              ) : (
                pagedCustomers.map((customer) => (
                  <tr
                    key={customer._id}
                    onClick={() =>
                      router.push(`/dashboard/customers/${customer._id}`)
                    }
                    className="cursor-pointer transition-colors hover:bg-neutral-50"
                  >
                    <td className="px-6 py-4 font-medium text-brand-dark whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        {formatCustomerName(customer.first, customer.last)}
                        {(customer.duplicateCount ?? 0) > 0 ? (
                          <span
                            className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 ring-1 ring-inset ring-amber-600/20"
                            title={`${customer.duplicateCount} other customer(s) share this phone`}
                          >
                            Possible duplicate
                          </span>
                        ) : null}
                        <CustomerContractBadges
                          contracts={
                            contractsByCustomerId.get(customer.legacyId) ?? []
                          }
                        />
                      </span>
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {formatPhone(customer.phone)}
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {customer.address ? toProperCase(customer.address) : "—"}
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {customer.city ? toProperCase(customer.city) : "—"}
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {formatCustomerState(customer.state)}
                    </td>
                    <td className="px-6 py-4 text-neutral-600 whitespace-nowrap">
                      {customer.zip?.trim() || "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {sortedCustomers.length > 0 && (
          <CustomersPagination
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={sortedCustomers.length}
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
      </div>
    </div>
  );
}

export default function CustomersPage() {
  return (
    <AuthGuard>
      <CustomersContent />
    </AuthGuard>
  );
}
