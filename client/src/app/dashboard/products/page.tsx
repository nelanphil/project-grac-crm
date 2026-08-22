"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ResponsiveDataView from "@/components/ui/ResponsiveDataView";
import MobileDataCard, { DataField } from "@/components/ui/MobileDataCard";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  createProduct,
  deleteProduct,
  getProducts,
  ProductItem,
  updateProduct,
} from "@/lib/api";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

type ProductFormState = {
  partNumber: string;
  name: string;
  unitPrice: string;
  active: boolean;
  notes: string;
};

const EMPTY_FORM: ProductFormState = {
  partNumber: "",
  name: "",
  unitPrice: "0",
  active: true,
  notes: "",
};

export default function ProductsPage() {
  return (
    <AuthGuard>
      <ProductsContent />
    </AuthGuard>
  );
}

function ProductsContent() {
  const token = useAuthStore((s) => s.token);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canWrite = hasPermission("products:write");
  const canDelete = hasPermission("products:delete");

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  async function reload() {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const { products: list } = await getProducts(token, {
        search: debouncedSearch || undefined,
        active: showInactive ? undefined : true,
      });
      setProducts(list);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load products.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, debouncedSearch, showInactive]);

  const visible = useMemo(() => products, [products]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(product: ProductItem) {
    setEditing(product);
    setForm({
      partNumber: product.partNumber,
      name: product.name,
      unitPrice: String(product.unitPrice ?? 0),
      active: product.active,
      notes: product.notes ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        partNumber: form.partNumber.trim(),
        name: form.name.trim(),
        unitPrice: Number(form.unitPrice) || 0,
        active: form.active,
        notes: form.notes.trim(),
      };
      if (editing) {
        await updateProduct(token, editing._id, payload);
      } else {
        await createProduct(token, payload);
      }
      setModalOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save product.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(product: ProductItem) {
    if (!token) return;
    if (!window.confirm(`Delete part ${product.partNumber}?`)) return;
    setDeletingId(product._id);
    setError(null);
    try {
      await deleteProduct(token, product._id);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete product.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-brand-dark">Products</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Part numbers and prices used on estimates and work orders.
          </p>
        </div>
        {canWrite ? (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Add product
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search part number or name"
            className="w-full rounded-lg border border-neutral-200 bg-white py-2 pl-9 pr-3 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
          />
        </div>
        <label className="inline-flex items-center gap-2 text-sm text-neutral-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Include inactive
        </label>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-xl border border-neutral-200 bg-white px-6 py-8 text-sm text-neutral-500">
          Loading products…
        </div>
      ) : (
        <ResponsiveDataView
          isEmpty={visible.length === 0}
          empty={
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-white py-24 text-center shadow-sm">
              <Package className="mb-4 h-10 w-10 text-neutral-300" />
              <p className="text-sm font-medium text-neutral-500">No products yet</p>
              <p className="mt-1 text-xs text-neutral-400">
                Add part numbers so they can be picked on estimates and work orders.
              </p>
            </div>
          }
          mobile={visible.map((product) => (
            <MobileDataCard
              key={product._id}
              title={product.partNumber}
              subtitle={product.name}
              badges={
                <span
                  className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                    product.active
                      ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20"
                      : "bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-neutral-300"
                  }`}
                >
                  {product.active ? "Active" : "Inactive"}
                </span>
              }
              fields={
                <>
                  <DataField label="Price" value={formatMoney(product.unitPrice)} />
                  <DataField label="Notes" value={product.notes || "—"} className="col-span-2" />
                </>
              }
              actions={
                canWrite || canDelete ? (
                  <div className="flex justify-end gap-2">
                    {canWrite ? (
                      <button
                        type="button"
                        onClick={() => openEdit(product)}
                        className="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      >
                        Edit
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        disabled={deletingId === product._id}
                        onClick={() => void handleDelete(product)}
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
          desktop={
            <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-neutral-100 text-sm">
                <thead className="bg-neutral-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Part number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Price
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
                  {visible.map((product) => (
                    <tr key={product._id} className="hover:bg-neutral-50">
                      <td className="px-6 py-4 font-medium text-brand-dark">
                        {product.partNumber}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">{product.name}</td>
                      <td className="px-6 py-4 text-neutral-700">
                        {formatMoney(product.unitPrice)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            product.active
                              ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20"
                              : "bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-neutral-300"
                          }`}
                        >
                          {product.active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex gap-2">
                          {canWrite ? (
                            <button
                              type="button"
                              onClick={() => openEdit(product)}
                              className="rounded-md border border-neutral-300 p-1.5 text-neutral-600 hover:bg-neutral-50"
                              aria-label="Edit product"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          ) : null}
                          {canDelete ? (
                            <button
                              type="button"
                              disabled={deletingId === product._id}
                              onClick={() => void handleDelete(product)}
                              className="rounded-md border border-red-200 p-1.5 text-red-700 hover:bg-red-50 disabled:opacity-60"
                              aria-label="Delete product"
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
          }
        />
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white p-6 shadow-xl sm:max-w-lg sm:rounded-xl">
            <h2 className="text-lg font-semibold text-brand-dark">
              {editing ? "Edit product" : "Add product"}
            </h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-neutral-600">Part number</span>
                <input
                  value={form.partNumber}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, partNumber: e.target.value }))
                  }
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-neutral-600">Name</span>
                <input
                  value={form.name}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-neutral-600">Unit price</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.unitPrice}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, unitPrice: e.target.value }))
                  }
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-neutral-600">Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, notes: e.target.value }))
                  }
                  rows={3}
                  className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue"
                />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-neutral-600">
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
                disabled={saving || !form.partNumber.trim() || !form.name.trim()}
                onClick={() => void handleSave()}
                className="rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
