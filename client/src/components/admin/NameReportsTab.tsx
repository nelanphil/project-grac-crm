"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import CustomerReputationControl from "@/components/customers/CustomerReputationControl";
import TablePagination from "@/components/ui/TablePagination";
import {
  ApiError,
  listContactNames,
  listCustomerNames,
  listVacantCustomers,
  updateContactName,
  updateCustomerName,
  type ContactNameRow,
  type CustomerNameRow,
  type CustomerReputation,
  type VacantCustomerRow,
} from "@/lib/api";
import {
  DEFAULT_PAGE_SIZE,
  paginationRange,
  type PageSize,
} from "@/lib/pagination";

type NameField = "accountName" | "first" | "last";
type ReputationFilter = "" | CustomerReputation | "unrated";

const REPUTATION_FILTERS: { value: ReputationFilter; label: string }[] = [
  { value: "", label: "All" },
  { value: "do_not_contact", label: "Do not contact" },
  { value: "past_due", label: "Past due" },
  { value: "good", label: "Good customer" },
  { value: "unrated", label: "Unrated" },
];

function EditableCell({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled?: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const cancelRef = useRef(false);
  const committingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  async function commit() {
    if (committingRef.current || cancelRef.current) return;
    if (draft === value) {
      setEditing(false);
      return;
    }
    committingRef.current = true;
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      inputRef.current?.focus();
    } finally {
      committingRef.current = false;
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        className="w-full rounded px-1 py-0.5 text-left text-brand-dark hover:bg-neutral-50 disabled:cursor-not-allowed"
      >
        {value ? (
          value
        ) : (
          <span className="text-neutral-400">Empty</span>
        )}
      </button>
    );
  }

  return (
    <input
      ref={inputRef}
      value={draft}
      disabled={saving}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelRef.current) {
          cancelRef.current = false;
          return;
        }
        void commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRef.current = true;
          setDraft(value);
          setEditing(false);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          void commit();
        }
      }}
      className="w-full rounded-md border border-neutral-200 px-2 py-1 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue disabled:opacity-60"
    />
  );
}

function ReportFrame({
  title,
  description,
  query,
  onQueryChange,
  searchPlaceholder = "Search names",
  toolbar,
  total,
  page,
  pageSize,
  onPageSizeChange,
  onPrev,
  onNext,
  loading,
  error,
  children,
}: {
  title: string;
  description: string;
  query: string;
  onQueryChange: (value: string) => void;
  searchPlaceholder?: string;
  toolbar?: ReactNode;
  total: number;
  page: number;
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  onPrev: () => void;
  onNext: () => void;
  loading: boolean;
  error: string;
  children: ReactNode;
}) {
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
    onPageSizeChange,
    onPrev,
    onNext,
  };

  return (
    <section className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      <div className="space-y-3 border-b border-neutral-100 px-4 py-4 sm:px-6">
        <div>
          <h2 className="text-base font-semibold text-brand-dark">{title}</h2>
          <p className="mt-1 text-sm text-neutral-500">{description}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="block max-w-sm flex-1 text-xs text-neutral-500">
            Filter
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
            />
          </label>
          {toolbar}
        </div>
      </div>
      {error ? (
        <p className="px-4 py-3 text-sm text-red-600 sm:px-6">{error}</p>
      ) : null}
      <TablePagination {...paginationProps} position="top" />
      <div className="overflow-x-auto">
        {loading ? (
          <p className="px-4 pt-3 text-xs text-neutral-400 sm:px-6">Loading…</p>
        ) : null}
        {children}
      </div>
      <TablePagination {...paginationProps} position="bottom" />
    </section>
  );
}

function useDebouncedQuery(input: string): string {
  const [query, setQuery] = useState(input);

  useEffect(() => {
    const id = window.setTimeout(() => setQuery(input), 300);
    return () => window.clearTimeout(id);
  }, [input]);

  return query;
}

type ReportView = "customers" | "vacant";

export default function NameReportsTab({ token }: { token: string | null }) {
  const [customerRefresh, setCustomerRefresh] = useState(0);
  const [contactRefresh, setContactRefresh] = useState(0);
  const [view, setView] = useState<ReportView>("customers");

  return (
    <div className="space-y-6">
      <div className="flex gap-1 overflow-x-auto border-b border-neutral-200">
        {(
          [
            { id: "customers", label: "Customer Names" },
            { id: "vacant", label: "Vacant" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setView(tab.id)}
            className={`shrink-0 border-b-2 px-3 pb-2 text-sm font-medium ${
              view === tab.id
                ? "border-brand-orange text-brand-dark"
                : "border-transparent text-neutral-500 hover:text-brand-dark"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {view === "customers" ? (
        <div className="space-y-8">
          <CustomerNamesTable
            token={token}
            refreshToken={customerRefresh}
            onPrimaryContactChanged={() =>
              setContactRefresh((value) => value + 1)
            }
          />
          <ContactNamesTable
            token={token}
            refreshToken={contactRefresh}
            onPrimaryCustomerChanged={() =>
              setCustomerRefresh((value) => value + 1)
            }
          />
        </div>
      ) : (
        <VacantCustomersTable token={token} />
      )}
    </div>
  );
}

function CustomerNamesTable({
  token,
  refreshToken,
  onPrimaryContactChanged,
}: {
  token: string | null;
  refreshToken: number;
  onPrimaryContactChanged: () => void;
}) {
  const [queryInput, setQueryInput] = useState("");
  const [reputationFilter, setReputationFilter] = useState<ReputationFilter>("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [rows, setRows] = useState<CustomerNameRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const query = useDebouncedQuery(queryInput);
  const appliedQuery = useRef(query);

  useEffect(() => {
    if (appliedQuery.current === query) return;
    appliedQuery.current = query;
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    listCustomerNames(token, {
      page,
      pageSize,
      q: query,
      reputation: reputationFilter || undefined,
    })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setPage((current) => (current === data.page ? current : data.page));
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load customer names.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, pageSize, query, reputationFilter, refreshToken]);

  async function save(row: CustomerNameRow, field: NameField, value: string) {
    if (!token) return;
    try {
      const result = await updateCustomerName(token, row.id, { [field]: value });
      setRows((current) =>
        current.map((item) => (item.id === result.row.id ? result.row : item)),
      );
      setRowErrors((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      if (result.contact) onPrimaryContactChanged();
    } catch (err: unknown) {
      const message =
        err instanceof ApiError ? err.message : "Failed to update customer name.";
      setRowErrors((current) => ({ ...current, [row.id]: message }));
      throw err;
    }
  }

  async function saveReputation(
    row: CustomerNameRow,
    value: CustomerReputation | null,
  ) {
    if (!token) return;
    try {
      const result = await updateCustomerName(token, row.id, {
        reputation: value,
      });
      const stillVisible =
        reputationFilter === "" ||
        (reputationFilter === "unrated"
          ? result.row.reputation == null
          : result.row.reputation === reputationFilter);
      setRows((current) =>
        stillVisible
          ? current.map((item) =>
              item.id === result.row.id ? result.row : item,
            )
          : current.filter((item) => item.id !== row.id),
      );
      if (!stillVisible) setTotal((current) => Math.max(0, current - 1));
      setRowErrors((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
    } catch (err: unknown) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Failed to update customer reputation.";
      setRowErrors((current) => ({ ...current, [row.id]: message }));
    }
  }

  return (
    <ReportFrame
      title="Customer names"
      description="Account names stay as stored. First and last names are saved in title case and copied onto the primary contact. Reputation is the staff signal for who to contact."
      query={queryInput}
      onQueryChange={setQueryInput}
      toolbar={
        <label className="block text-xs text-neutral-500">
          Reputation
          <select
            value={reputationFilter}
            onChange={(event) => {
              setReputationFilter(event.target.value as ReputationFilter);
              setPage(1);
            }}
            className="mt-1 w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue sm:w-48"
          >
            {REPUTATION_FILTERS.map((option) => (
              <option key={option.value || "all"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      }
      total={total}
      page={page}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      onPrev={() => setPage((current) => Math.max(1, current - 1))}
      onNext={() => setPage((current) => current + 1)}
      loading={loading}
      error={error}
    >
      {!loading && rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-neutral-500 sm:px-6">
          No customers match this filter.
        </p>
      ) : rows.length === 0 ? null : (
        <table className="min-w-full divide-y divide-neutral-100 text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 sm:px-6">
                Account name
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">
                First
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 sm:px-6">
                Last
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 sm:px-6">
                Reputation
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2 align-top sm:px-6">
                  <EditableCell
                    value={row.accountName}
                    onSave={(value) => save(row, "accountName", value)}
                  />
                  {rowErrors[row.id] ? (
                    <p className="mt-1 px-1 text-xs text-red-600">
                      {rowErrors[row.id]}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-2 align-top">
                  <EditableCell
                    value={row.first}
                    onSave={(value) => save(row, "first", value)}
                  />
                </td>
                <td className="px-4 py-2 align-top">
                  <EditableCell
                    value={row.last}
                    onSave={(value) => save(row, "last", value)}
                  />
                </td>
                <td className="px-4 py-2 align-top sm:px-6">
                  <CustomerReputationControl
                    value={row.reputation}
                    disabled={!token}
                    onChange={(value) => void saveReputation(row, value)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportFrame>
  );
}

function ContactNamesTable({
  token,
  refreshToken,
  onPrimaryCustomerChanged,
}: {
  token: string | null;
  refreshToken: number;
  onPrimaryCustomerChanged: () => void;
}) {
  const [queryInput, setQueryInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [rows, setRows] = useState<ContactNameRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const query = useDebouncedQuery(queryInput);
  const appliedQuery = useRef(query);

  useEffect(() => {
    if (appliedQuery.current === query) return;
    appliedQuery.current = query;
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    listContactNames(token, { page, pageSize, q: query })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setPage((current) => (current === data.page ? current : data.page));
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Failed to load contact names.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, pageSize, query, refreshToken]);

  async function save(
    row: ContactNameRow,
    field: "first" | "last",
    value: string,
  ) {
    if (!token) return;
    try {
      const result = await updateContactName(token, row.id, { [field]: value });
      setRows((current) =>
        current.map((item) => (item.id === result.row.id ? result.row : item)),
      );
      setRowErrors((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      if (result.customer) onPrimaryCustomerChanged();
    } catch (err: unknown) {
      const message =
        err instanceof ApiError ? err.message : "Failed to update contact name.";
      setRowErrors((current) => ({ ...current, [row.id]: message }));
      throw err;
    }
  }

  return (
    <ReportFrame
      title="Contact names"
      description="First and last names are saved in title case. Editing a primary contact updates that customer’s first and last name."
      query={queryInput}
      onQueryChange={setQueryInput}
      total={total}
      page={page}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      onPrev={() => setPage((current) => Math.max(1, current - 1))}
      onNext={() => setPage((current) => current + 1)}
      loading={loading}
      error={error}
    >
      {!loading && rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-neutral-500 sm:px-6">
          No contacts match this filter.
        </p>
      ) : rows.length === 0 ? null : (
        <table className="min-w-full divide-y divide-neutral-100 text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 sm:px-6">
                First
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">
                Last
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">
                Customer
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 sm:px-6">
                Primary
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2 align-top sm:px-6">
                  <EditableCell
                    value={row.first}
                    onSave={(value) => save(row, "first", value)}
                  />
                  {rowErrors[row.id] ? (
                    <p className="mt-1 px-1 text-xs text-red-600">
                      {rowErrors[row.id]}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-2 align-top">
                  <EditableCell
                    value={row.last}
                    onSave={(value) => save(row, "last", value)}
                  />
                </td>
                <td className="px-4 py-2 align-top">
                  <Link
                    href={`/dashboard/customers/detail?id=${row.customerId}`}
                    className="text-brand-blue hover:underline"
                  >
                    {row.customerName}
                  </Link>
                </td>
                <td className="px-4 py-2 align-top sm:px-6">
                  {row.isPrimary ? (
                    <span className="inline-flex rounded-full border border-brand-blue/20 bg-brand-blue/5 px-2 py-0.5 text-xs font-medium text-brand-dark">
                      Primary
                    </span>
                  ) : (
                    <span className="text-neutral-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportFrame>
  );
}

function VacantCustomersTable({ token }: { token: string | null }) {
  const [queryInput, setQueryInput] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [rows, setRows] = useState<VacantCustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useDebouncedQuery(queryInput);
  const appliedQuery = useRef(query);

  useEffect(() => {
    if (appliedQuery.current === query) return;
    appliedQuery.current = query;
    setPage(1);
  }, [query]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    listVacantCustomers(token, { page, pageSize, q: query })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setError("");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load vacant customers.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, page, pageSize, query]);

  return (
    <ReportFrame
      title="Vacant"
      description="Properties with no contact. New Owner sets the customer name to Vacant until a person is assigned."
      query={queryInput}
      onQueryChange={setQueryInput}
      searchPlaceholder="Search name or address"
      total={total}
      page={page}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      onPrev={() => setPage((current) => Math.max(1, current - 1))}
      onNext={() => setPage((current) => current + 1)}
      loading={loading}
      error={error}
    >
      {!loading && rows.length === 0 ? (
        <p className="px-4 py-8 text-sm text-neutral-500 sm:px-6">
          No vacant customers match this filter.
        </p>
      ) : rows.length === 0 ? null : (
        <table className="min-w-full divide-y divide-neutral-100 text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 sm:px-6">
                Customer
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">
                Address
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">
                City
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">
                State
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500">
                ZIP
              </th>
              <th className="px-4 py-2 text-left text-xs font-medium text-neutral-500 sm:px-6">
                County
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-2 align-top sm:px-6">
                  <Link
                    href={`/dashboard/customers/detail?id=${row.id}`}
                    className="text-brand-blue hover:underline"
                  >
                    {row.accountName || "Vacant"}
                  </Link>
                </td>
                <td className="px-4 py-2 align-top text-brand-dark">
                  {row.address || "—"}
                </td>
                <td className="px-4 py-2 align-top text-brand-dark">
                  {row.city || "—"}
                </td>
                <td className="px-4 py-2 align-top text-brand-dark">
                  {row.state || "—"}
                </td>
                <td className="px-4 py-2 align-top text-brand-dark">
                  {row.zip || "—"}
                </td>
                <td className="px-4 py-2 align-top text-brand-dark sm:px-6">
                  {row.county || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportFrame>
  );
}
