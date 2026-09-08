"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, TicketPercent, Trash2 } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import FilterStatsCards, {
  FilterStatItem,
} from "@/components/ui/FilterStatsCards";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import TablePagination from "@/components/ui/TablePagination";
import { useAuthStore } from "@/store/useAuthStore";
import {
  DEFAULT_PAGE_SIZE,
  paginationRange,
  type PageSize,
} from "@/lib/pagination";
import {
  ApiError,
  createDiscountCode,
  deleteDiscountCode,
  DiscountAppliesTo,
  DiscountCodeItem,
  DiscountMode,
  getDiscountCodes,
  updateDiscountCode,
} from "@/lib/api";

type StatusFilter = "all" | "active" | "inactive" | "expired";

function formatMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

function isExpired(code: DiscountCodeItem, now = Date.now()): boolean {
  if (!code.expiresAt) return false;
  const at = new Date(code.expiresAt).getTime();
  return !Number.isNaN(at) && at <= now;
}

function statusOf(code: DiscountCodeItem): "active" | "inactive" | "expired" {
  if (isExpired(code)) return "expired";
  return code.active ? "active" : "inactive";
}

function formatValue(code: DiscountCodeItem): string {
  if (code.mode === "percent") return `${code.value}% off`;
  return `${formatMoney(code.value)} off`;
}

function formatAppliesTo(appliesTo: DiscountAppliesTo[]): string {
  if (appliesTo.length === 0) return "All items";
  const labels = appliesTo.map((item) =>
    item === "work_order" ? "Work orders" : "Contracts",
  );
  return labels.join(", ");
}

function dateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function expiresPayload(date: string): string | null {
  if (!date) return null;
  return `${date}T23:59:59.000Z`;
}

type FormState = {
  code: string;
  label: string;
  mode: DiscountMode;
  value: string;
  active: boolean;
  expiresAt: string;
  maxRedemptions: string;
  maxRedemptionsPerCustomer: string;
  minSubtotal: string;
  workOrders: boolean;
  contracts: boolean;
};

const EMPTY_FORM: FormState = {
  code: "",
  label: "",
  mode: "percent",
  value: "10",
  active: true,
  expiresAt: "",
  maxRedemptions: "",
  maxRedemptionsPerCustomer: "",
  minSubtotal: "",
  workOrders: true,
  contracts: true,
};

function optionalInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function parseValue(form: FormState): number | null {
  const n = Number(form.value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (form.mode === "percent") return Math.floor(n);
  return Math.round(n * 100);
}

function appliesToFromForm(form: FormState): DiscountAppliesTo[] {
  if (form.workOrders && form.contracts) return [];
  const next: DiscountAppliesTo[] = [];
  if (form.workOrders) next.push("work_order");
  if (form.contracts) next.push("contract");
  return next;
}

const WRITE_ROLES = new Set(["admin", "super-admin", "owner", "manager"]);
const DELETE_ROLES = new Set(["admin", "super-admin", "owner"]);

export default function DiscountCodesPage() {
  return (
    <AuthGuard>
      <DiscountCodesContent />
    </AuthGuard>
  );
}

function DiscountCodesContent() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const canWrite =
    useAuthStore((s) => s.hasPermission("discounts:write")) ||
    WRITE_ROLES.has(role ?? "");
  const canDelete =
    useAuthStore((s) => s.hasPermission("discounts:delete")) ||
    DELETE_ROLES.has(role ?? "");

  const [codes, setCodes] = useState<DiscountCodeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DiscountCodeItem | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  async function reload() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const { discountCodes } = await getDiscountCodes(token, {
        search: debouncedSearch || undefined,
      });
      setCodes(discountCodes);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load discount codes.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, debouncedSearch]);

  const filtered = useMemo(
    () =>
      codes.filter((code) => {
        if (statusFilter === "all") return true;
        return statusOf(code) === statusFilter;
      }),
    [codes, statusFilter],
  );

  const stats = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let expired = 0;
    for (const code of codes) {
      const status = statusOf(code);
      if (status === "active") active += 1;
      else if (status === "inactive") inactive += 1;
      else expired += 1;
    }
    return { total: codes.length, active, inactive, expired };
  }, [codes]);

  const { safePage, totalPages, rangeStart, rangeEnd } = paginationRange(
    page,
    pageSize,
    filtered.length,
  );
  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, safePage, pageSize]);

  const paginationProps = {
    rangeStart,
    rangeEnd,
    total: filtered.length,
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

  const statItems: FilterStatItem<StatusFilter>[] = [
    { label: "All", value: String(stats.total), tone: "neutral", filter: "all" },
    { label: "Active", value: String(stats.active), tone: "success", filter: "active" },
    {
      label: "Inactive",
      value: String(stats.inactive),
      tone: "warning",
      filter: "inactive",
    },
    { label: "Expired", value: String(stats.expired), tone: "danger", filter: "expired" },
  ];

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(code: DiscountCodeItem) {
    setEditing(code);
    const both =
      code.appliesTo.length === 0 ||
      (code.appliesTo.includes("work_order") &&
        code.appliesTo.includes("contract"));
    setForm({
      code: code.code,
      label: code.label,
      mode: code.mode,
      value:
        code.mode === "percent"
          ? String(code.value)
          : (code.value / 100).toFixed(2),
      active: code.active,
      expiresAt: dateInputValue(code.expiresAt),
      maxRedemptions: code.maxRedemptions != null ? String(code.maxRedemptions) : "",
      maxRedemptionsPerCustomer:
        code.maxRedemptionsPerCustomer != null
          ? String(code.maxRedemptionsPerCustomer)
          : "",
      minSubtotal:
        code.minSubtotalCents != null
          ? (code.minSubtotalCents / 100).toFixed(2)
          : "",
      workOrders: both || code.appliesTo.includes("work_order"),
      contracts: both || code.appliesTo.includes("contract"),
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!token) return;
    const value = parseValue(form);
    if (!form.code.trim()) {
      setError("Code is required.");
      return;
    }
    if (value == null) {
      setError(
        form.mode === "percent"
          ? "Enter a percent between 1 and 100."
          : "Enter a dollar amount greater than zero.",
      );
      return;
    }
    if (form.mode === "percent" && value > 100) {
      setError("Percent must be between 1 and 100.");
      return;
    }
    if (!form.workOrders && !form.contracts) {
      setError("Select at least one item type this code applies to.");
      return;
    }

    const payload = {
      code: form.code.trim().toUpperCase(),
      label: form.label.trim(),
      mode: form.mode,
      value,
      active: form.active,
      expiresAt: expiresPayload(form.expiresAt),
      maxRedemptions: optionalInt(form.maxRedemptions),
      maxRedemptionsPerCustomer: optionalInt(form.maxRedemptionsPerCustomer),
      minSubtotalCents: form.minSubtotal.trim()
        ? Math.round(Number(form.minSubtotal) * 100)
        : null,
      appliesTo: appliesToFromForm(form),
    };
    if (
      payload.minSubtotalCents != null &&
      (!Number.isFinite(payload.minSubtotalCents) || payload.minSubtotalCents < 1)
    ) {
      setError("Minimum order amount is invalid.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateDiscountCode(token, editing._id, payload);
      } else {
        await createDiscountCode(token, payload);
      }
      setModalOpen(false);
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to save discount code.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(code: DiscountCodeItem) {
    if (!token) return;
    if (!window.confirm(`Delete discount code ${code.code}?`)) return;
    setDeletingId(code._id);
    setError(null);
    try {
      await deleteDiscountCode(token, code._id);
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to delete discount code.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function statusBadge(code: DiscountCodeItem) {
    const status = statusOf(code);
    const styles =
      status === "active"
        ? "bg-green-50 text-green-700 ring-green-600/20"
        : status === "expired"
          ? "bg-red-50 text-red-700 ring-red-600/20"
          : "bg-neutral-100 text-neutral-500 ring-neutral-300";
    const label =
      status === "active" ? "Active" : status === "expired" ? "Expired" : "Inactive";
    return (
      <span
        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${styles}`}
      >
        {label}
      </span>
    );
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Discount codes</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Promo codes customers can apply at checkout.
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add code
          </button>
        ) : null}
      </div>

      <FilterStatsCards
        title="Discount code stats"
        icon={TicketPercent}
        columns={4}
        items={statItems}
        selected={statusFilter}
        onSelect={(filter) => {
          setStatusFilter(filter);
          setPage(1);
        }}
      />

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code or name"
          className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
        />
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading discount codes…
        </div>
      ) : (
        <ResponsiveDataView
          isEmpty={filtered.length === 0}
          empty={
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
              <TicketPercent className="mb-4 h-10 w-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">
                No discount codes yet
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                Create a code so customers can apply it at checkout.
              </p>
              {canWrite ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  <Plus className="h-4 w-4" />
                  Add code
                </button>
              ) : null}
            </div>
          }
          mobile={
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="top" />
              </div>
              {paged.map((code) => (
                <MobileDataCard
                  key={code._id}
                  title={code.code}
                  subtitle={code.label || formatValue(code)}
                  badges={statusBadge(code)}
                  fields={
                    <>
                      <DataField label="Discount" value={formatValue(code)} />
                      <DataField
                        label="Uses"
                        value={
                          code.maxRedemptions != null
                            ? `${code.redemptionCount} / ${code.maxRedemptions}`
                            : String(code.redemptionCount)
                        }
                      />
                      <DataField
                        label="Applies to"
                        value={formatAppliesTo(code.appliesTo)}
                        className="col-span-2"
                      />
                    </>
                  }
                  actions={
                    canWrite || canDelete ? (
                      <div className="flex justify-end gap-2">
                        {canWrite ? (
                          <button
                            type="button"
                            onClick={() => openEdit(code)}
                            className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            disabled={deletingId === code._id}
                            onClick={() => void handleDelete(code)}
                            className="rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                          >
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ) : null
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
                      Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Discount
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Min
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Uses
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Per customer
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Applies to
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Expires
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Status
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {paged.map((code) => (
                    <tr key={code._id} className="hover:bg-neutral-50">
                      <td className="px-6 py-4 font-medium text-brand-dark">
                        <div>{code.code}</div>
                        {code.label ? (
                          <div className="text-xs font-normal text-neutral-400">
                            {code.label}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-neutral-700">
                        {formatValue(code)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {code.minSubtotalCents
                          ? formatMoney(code.minSubtotalCents)
                          : "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {code.maxRedemptions != null
                          ? `${code.redemptionCount} / ${code.maxRedemptions}`
                          : code.redemptionCount}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {code.maxRedemptionsPerCustomer ?? "—"}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {formatAppliesTo(code.appliesTo)}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">
                        {code.expiresAt
                          ? new Date(code.expiresAt).toLocaleDateString()
                          : "—"}
                      </td>
                      <td className="px-6 py-4">{statusBadge(code)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex gap-2">
                          {canWrite ? (
                            <button
                              type="button"
                              onClick={() => openEdit(code)}
                              className="rounded-md border border-neutral-300 p-1.5 text-neutral-600 hover:bg-neutral-50"
                              aria-label="Edit discount code"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              type="button"
                              disabled={deletingId === code._id}
                              onClick={() => void handleDelete(code)}
                              className="rounded-md border border-red-200 p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-60"
                              aria-label="Delete discount code"
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
              <TablePagination {...paginationProps} position="bottom" />
            </div>
          }
        />
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white p-6 shadow-xl sm:max-w-xl sm:rounded-xl">
            <h2 className="text-lg font-semibold text-brand-dark">
              {editing ? "Edit discount code" : "Add discount code"}
            </h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-neutral-700">
                  Code <span className="text-red-600">*</span>
                </span>
                <input
                  value={form.code}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      code: e.target.value.toUpperCase().replace(/\s+/g, ""),
                    }))
                  }
                  className={inputClass}
                  placeholder="SAVE10"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-neutral-700">Name</span>
                <input
                  value={form.label}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, label: e.target.value }))
                  }
                  className={inputClass}
                  placeholder="Spring special"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-neutral-700">Type</span>
                <select
                  value={form.mode}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      mode: e.target.value as DiscountMode,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="percent">Percent off</option>
                  <option value="amount">Dollar off</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="font-medium text-neutral-700">
                  {form.mode === "percent" ? "Percent" : "Amount"}{" "}
                  <span className="text-red-600">*</span>
                </span>
                <input
                  value={form.value}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, value: e.target.value }))
                  }
                  className={inputClass}
                  inputMode="decimal"
                  placeholder={form.mode === "percent" ? "10" : "25.00"}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-neutral-700">Expires</span>
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, expiresAt: e.target.value }))
                  }
                  className={inputClass}
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-neutral-700">
                  Minimum order
                </span>
                <input
                  value={form.minSubtotal}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, minSubtotal: e.target.value }))
                  }
                  className={inputClass}
                  inputMode="decimal"
                  placeholder="Optional"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-neutral-700">Max uses</span>
                <input
                  value={form.maxRedemptions}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      maxRedemptions: e.target.value,
                    }))
                  }
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="Unlimited"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-neutral-700">
                  Max uses per customer
                </span>
                <input
                  value={form.maxRedemptionsPerCustomer}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      maxRedemptionsPerCustomer: e.target.value,
                    }))
                  }
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="Unlimited"
                />
              </label>
              <div className="sm:col-span-2 space-y-2 text-sm">
                <span className="font-medium text-neutral-700">Applies to</span>
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 text-neutral-700">
                    <input
                      type="checkbox"
                      checked={form.workOrders}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          workOrders: e.target.checked,
                        }))
                      }
                    />
                    Work orders
                  </label>
                  <label className="inline-flex items-center gap-2 text-neutral-700">
                    <input
                      type="checkbox"
                      checked={form.contracts}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          contracts: e.target.checked,
                        }))
                      }
                    />
                    Contracts
                  </label>
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, active: e.target.checked }))
                  }
                />
                Active
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Create code"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
