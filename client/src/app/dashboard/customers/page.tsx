"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { useAuthStore } from "@/store/useAuthStore";
import {
  getCustomers,
  getContracts,
  createCustomer,
  softDeleteCustomer,
  restoreCustomer,
  validateCustomerAddress,
  CustomerListItem,
  ContractListItem,
  CreateCustomerInput,
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
type ListView = "active" | "deleted";

const EMPTY_CREATE_FORM: CreateCustomerInput = {
  first: "",
  last: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  zip: "",
};

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
  const canManageCustomers = useAuthStore((s) =>
    s.hasRole("admin", "super-admin", "owner"),
  );
  const canReadContracts = useAuthStore((s) =>
    s.hasPermission("contracts:read"),
  );

  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [contractsByCustomerId, setContractsByCustomerId] = useState<
    Map<number, ContractListItem[]>
  >(() => new Map());
  const [search, setSearch] = useState("");
  const [listView, setListView] = useState<ListView>("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [sortKey, setSortKey] = useState<SortKey>("customer");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] =
    useState<CreateCustomerInput>(EMPTY_CREATE_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [addressValidated, setAddressValidated] = useState(false);
  const [validatingAddress, setValidatingAddress] = useState(false);
  const [addressValidationMsg, setAddressValidationMsg] = useState<
    string | null
  >(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

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

    const deletedOnly = canManageCustomers && listView === "deleted";
    const customersPromise = getCustomers(token, { deletedOnly });
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
  }, [token, user, canReadContracts, canManageCustomers, listView]);

  function openCreate() {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateError(null);
    setAddressValidated(false);
    setAddressValidationMsg(null);
    setCreateOpen(true);
  }

  function closeCreate() {
    if (creating || validatingAddress) return;
    setCreateOpen(false);
    setCreateError(null);
    setAddressValidated(false);
    setAddressValidationMsg(null);
  }

  function updateCreateAddressField<K extends keyof CreateCustomerInput>(
    key: K,
    value: CreateCustomerInput[K],
  ) {
    setCreateForm((f) => ({ ...f, [key]: value }));
    if (addressValidated || addressValidationMsg) {
      setAddressValidated(false);
      setAddressValidationMsg(null);
    }
  }

  async function handleValidateAddress() {
    if (!token) return;
    const street = createForm.address?.trim() || "";
    if (!street) {
      setAddressValidated(false);
      setAddressValidationMsg("Enter a street address to validate.");
      return;
    }

    setValidatingAddress(true);
    setAddressValidationMsg(null);
    setAddressValidated(false);
    try {
      const result = await validateCustomerAddress(token, {
        address: street,
        city: createForm.city?.trim() || "",
        state: createForm.state?.trim() || "",
        zip: createForm.zip?.trim() || "",
      });
      if (!result.valid || !result.address) {
        setAddressValidated(false);
        setAddressValidationMsg(
          result.message || "Address could not be validated.",
        );
        return;
      }

      setCreateForm((f) => ({
        ...f,
        address: result.address!.address,
        city: result.address!.city,
        state: result.address!.state,
        zip: result.address!.zip,
      }));
      setAddressValidated(true);
      setAddressValidationMsg(
        result.matchedAddress
          ? `Matched: ${result.matchedAddress}`
          : "Address validated.",
      );
    } catch (err) {
      setAddressValidated(false);
      setAddressValidationMsg(
        err instanceof ApiError
          ? err.message
          : "Address validation failed. Try again.",
      );
    } finally {
      setValidatingAddress(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    const first = createForm.first.trim();
    const last = createForm.last.trim();
    if (!first && !last) {
      setCreateError("First or last name is required.");
      return;
    }
    if (!addressValidated) {
      setCreateError("Validate the address before creating the customer.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const { customer } = await createCustomer(token, {
        first,
        last,
        phone: createForm.phone?.trim() || "",
        email: createForm.email?.trim() || "",
        address: createForm.address?.trim() || "",
        city: createForm.city?.trim() || "",
        state: createForm.state?.trim() || "",
        zip: createForm.zip?.trim() || "",
      });
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
      setAddressValidated(false);
      setAddressValidationMsg(null);
      if (listView === "deleted") {
        setListView("active");
      } else {
        setCustomers((prev) => [customer, ...prev]);
      }
      setPage(1);
      router.push(`/dashboard/customers/detail?id=${customer._id}`);
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : "Failed to create customer.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleSoftDelete(customer: CustomerListItem) {
    if (!token) return;
    const name = formatCustomerName(customer.first, customer.last);
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
      setCustomers((prev) => prev.filter((c) => c._id !== customer._id));
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
      setCustomers((prev) => prev.filter((c) => c._id !== customer._id));
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Failed to restore customer.",
      );
    } finally {
      setRestoringId(null);
    }
  }

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

  const colCount = canManageCustomers ? 7 : 6;
  const showingDeleted = canManageCustomers && listView === "deleted";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Customers</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {search.trim()
              ? `${sortedCustomers.length} of ${customers.length} ${showingDeleted ? "deleted " : ""}customers`
              : `${customers.length} ${showingDeleted ? "deleted" : "total"}`}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
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
          {canManageCustomers ? (
            <>
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
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:bg-brand-dark/90"
              >
                <Plus className="h-4 w-4" />
                Add Customer
              </button>
            </>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

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
                {canManageCustomers ? (
                  <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Actions
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 bg-white">
              {sortedCustomers.length === 0 ? (
                <tr>
                  <td
                    colSpan={colCount}
                    className="px-6 py-12 text-center text-neutral-500"
                  >
                    {search.trim()
                      ? "No customers match your search."
                      : showingDeleted
                        ? "No deleted customers."
                        : "No customers found."}
                  </td>
                </tr>
              ) : (
                pagedCustomers.map((customer) => {
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
                          {formatCustomerName(customer.first, customer.last)}
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
                          {!isDeleted ? (
                            <CustomerContractBadges
                              contracts={
                                contractsByCustomerId.get(customer.legacyId) ??
                                []
                              }
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
                          : "—"}
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
                                ? "Restoring…"
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
                })
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

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="border-b border-neutral-100 px-6 py-4">
              <h3 className="text-lg font-semibold text-brand-dark">
                Add Customer
              </h3>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              {createError ? (
                <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {createError}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    First name
                  </label>
                  <input
                    value={createForm.first}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, first: e.target.value }))
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    Last name
                  </label>
                  <input
                    value={createForm.last}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, last: e.target.value }))
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    Phone
                  </label>
                  <input
                    type="tel"
                    value={createForm.phone}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, phone: e.target.value }))
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    Email
                  </label>
                  <input
                    type="email"
                    value={createForm.email}
                    onChange={(e) =>
                      setCreateForm((f) => ({ ...f, email: e.target.value }))
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-brand-dark">
                  Street <span className="text-red-500">*</span>
                </label>
                <input
                  value={createForm.address}
                  onChange={(e) =>
                    updateCreateAddressField("address", e.target.value)
                  }
                  required
                  className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block text-sm font-medium text-brand-dark">
                    City
                  </label>
                  <input
                    value={createForm.city}
                    onChange={(e) =>
                      updateCreateAddressField("city", e.target.value)
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    State
                  </label>
                  <input
                    value={createForm.state}
                    onChange={(e) =>
                      updateCreateAddressField("state", e.target.value)
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-brand-dark">
                    Zip
                  </label>
                  <input
                    value={createForm.zip}
                    onChange={(e) =>
                      updateCreateAddressField("zip", e.target.value)
                    }
                    className="mt-1 block w-full rounded-md border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-brand-orange"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleValidateAddress()}
                    disabled={validatingAddress || creating}
                    className="rounded-md border border-neutral-200 px-3 py-2 text-sm font-medium text-brand-dark hover:bg-neutral-50 disabled:opacity-60"
                  >
                    {validatingAddress ? "Validating…" : "Validate address"}
                  </button>
                  {addressValidated ? (
                    <span className="text-xs font-medium text-emerald-700">
                      Address verified
                    </span>
                  ) : null}
                </div>
                {addressValidationMsg ? (
                  <p
                    className={`text-xs ${
                      addressValidated ? "text-emerald-700" : "text-red-600"
                    }`}
                  >
                    {addressValidationMsg}
                  </p>
                ) : (
                  <p className="text-xs text-neutral-500">
                    Validate the address before creating. Fields update to the
                    matched US Census address.
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={closeCreate}
                  disabled={creating || validatingAddress}
                  className="rounded-md border border-neutral-200 px-4 py-2 text-sm font-medium text-brand-dark hover:bg-neutral-50 disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating || validatingAddress || !addressValidated}
                  className="btn-primary text-sm px-4 py-2 disabled:opacity-60"
                >
                  {creating ? "Creating…" : "Create customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
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
