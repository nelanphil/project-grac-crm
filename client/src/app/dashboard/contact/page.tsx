"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Phone,
  Search,
} from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  ContactListItem,
  getContacts,
} from "@/lib/api";
import {
  formatCustomerName,
  formatCustomerRecordName,
  toProperCase,
} from "@/lib/formatName";

const PAGE_SIZE_OPTIONS = [25, 50, 150, 250, 500] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type SortKey = "name" | "phone" | "email" | "label" | "customer" | "primary";
type SortDir = "asc" | "desc";

function formatPhone(phone: string): string {
  if (!phone) return "\u2014";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)})${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
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

function ContactsPagination({
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

function ContactsContent() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const user = useAuthStore((s) => s.user);

  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

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

    getContacts(token, {
      page,
      pageSize,
      search: debouncedSearch,
      sortKey,
      sortDir,
    })
      .then(({ contacts: list, total: totalCount }) => {
        if (cancelled) return;
        setContacts(list);
        setTotal(totalCount);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load contacts.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, user, page, pageSize, sortKey, sortDir, debouncedSearch]);

  if (!user || user.role === "customer") return null;

  if (loading && contacts.length === 0)
    return (
      <div className="flex items-center gap-1 text-sm text-neutral-500 py-6">
        <span>Loading contacts</span>
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Contacts</h1>
          <p className="mt-1 text-sm text-neutral-500">
            {debouncedSearch
              ? `${total} match${total === 1 ? "" : "es"}`
              : `${total} total`}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search by name, phone, email, or customer\u2026"
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark outline-none transition-colors placeholder:text-neutral-400 focus:border-brand-orange"
          />
        </div>
      </div>

      <div className="rounded-xl border border-neutral-200 bg-white shadow-sm overflow-hidden">
        {total > 0 && (
          <ContactsPagination
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={total}
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

        <ResponsiveDataView
          isEmpty={contacts.length === 0}
          empty={
            <div className="px-6 py-16 text-center">
              <Phone className="mx-auto mb-4 h-10 w-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">
                No contacts yet
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Customer contact records will appear here.
              </p>
            </div>
          }
          className="p-3 md:p-0"
          mobile={contacts.map((contact) => {
            const name =
              formatCustomerName(contact.first, contact.last) || "\u2014";
            const customerName =
              formatCustomerRecordName(contact.customer) || "\u2014";

            return (
              <MobileDataCard
                key={contact._id}
                title={name}
                subtitle={
                  contact.label?.trim()
                    ? toProperCase(contact.label)
                    : undefined
                }
                badges={
                  contact.isPrimary ? (
                    <span className="inline-flex rounded-full bg-brand-dark/5 px-2 py-0.5 text-xs font-medium text-brand-dark">
                      Primary
                    </span>
                  ) : null
                }
                fields={
                  <>
                    <DataField
                      label="Phone"
                      value={formatPhone(contact.phone)}
                    />
                    <DataField
                      label="Email"
                      value={contact.email?.trim() || "\u2014"}
                    />
                    <DataField
                      label="Customer"
                      value={
                        <Link
                          href={`/dashboard/customers/detail?id=${contact.customer._id}`}
                          className="font-medium text-brand-blue hover:underline"
                        >
                          {customerName}
                        </Link>
                      }
                      className="col-span-2"
                    />
                  </>
                }
              />
            );
          })}
          desktop={
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-neutral-100 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <SortHeader
                      label="Name"
                      column="name"
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
                      label="Email"
                      column="email"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Label"
                      column="label"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Primary"
                      column="primary"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                    <SortHeader
                      label="Customer"
                      column="customer"
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                    />
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {contacts.map((contact) => {
                    const name =
                      formatCustomerName(contact.first, contact.last) ||
                      "\u2014";
                    const customerName =
                      formatCustomerRecordName(contact.customer) || "\u2014";

                    return (
                      <tr
                        key={contact._id}
                        className="hover:bg-neutral-50/80 transition-colors"
                      >
                        <td className="whitespace-nowrap px-6 py-3 font-medium text-brand-dark">
                          {name}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-neutral-600">
                          {formatPhone(contact.phone)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-neutral-600">
                          {contact.email?.trim() || "\u2014"}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-neutral-600">
                          {contact.label?.trim()
                            ? toProperCase(contact.label)
                            : "\u2014"}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3 text-neutral-600">
                          {contact.isPrimary ? (
                            <span className="inline-flex rounded-full bg-brand-dark/5 px-2 py-0.5 text-xs font-medium text-brand-dark">
                              Primary
                            </span>
                          ) : (
                            "\u2014"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-3">
                          <Link
                            href={`/dashboard/customers/detail?id=${contact.customer._id}`}
                            className="font-medium text-brand-blue hover:underline"
                          >
                            {customerName}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          }
        />

        {total > 0 && (
          <ContactsPagination
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            total={total}
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

export default function ContactPage() {
  return (
    <AuthGuard>
      <Suspense
        fallback={
          <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
            Loading contacts…
          </div>
        }
      >
        <ContactsContent />
      </Suspense>
    </AuthGuard>
  );
}
