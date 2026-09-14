"use client";

import { useEffect, useMemo, useState } from "react";
import { Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ProductEditorFields, {
  EMPTY_PRODUCT_FORM,
  defaultManufacturerId,
  isProductFormComplete,
  moneyString,
  normalizeProductCode,
  toProductWritePayload,
  uppercaseText,
  type ProductFormState,
} from "@/components/products/ProductEditorFields";
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
  createManufacturer,
  createProduct,
  deleteProduct,
  getManufacturers,
  getProducts,
  ManufacturerItem,
  ProductItem,
  ProductKind,
  updateProduct,
} from "@/lib/api";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

function productCodeOf(product: ProductItem): string {
  return normalizeProductCode(product.productCode || product.partNumber || "");
}

function listPriceOf(product: ProductItem): number {
  return product.listPrice ?? product.unitPrice ?? 0;
}

function PriceDisplay({
  listPrice,
  strikeThroughPrice,
}: {
  listPrice: number;
  strikeThroughPrice?: number;
}) {
  const strike = strikeThroughPrice && strikeThroughPrice > 0;
  return (
    <span className="inline-flex items-baseline gap-2">
      {strike ? (
        <span className="text-neutral-400 line-through">
          {formatMoney(strikeThroughPrice)}
        </span>
      ) : null}
      <span>{formatMoney(listPrice)}</span>
    </span>
  );
}

function KindBadge({ kind }: { kind: ProductKind }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        kind === "labor"
          ? "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-600/20"
          : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20"
      }`}
    >
      {kind === "labor" ? "Labor" : "Part"}
    </span>
  );
}

export default function ProductsPage() {
  return (
    <AuthGuard>
      <ProductsContent />
    </AuthGuard>
  );
}

const PRODUCT_WRITE_ROLES = new Set(["admin", "super-admin", "owner", "manager"]);
const PRODUCT_DELETE_ROLES = new Set(["admin", "super-admin", "owner"]);

function ProductsContent() {
  const token = useAuthStore((s) => s.token);
  const role = useAuthStore((s) => s.user?.role);
  const permissions = useAuthStore((s) => s.user?.permissions);
  const canWrite =
    permissions?.includes("products:write") ||
    PRODUCT_WRITE_ROLES.has(role ?? "");
  const canDelete =
    permissions?.includes("products:delete") ||
    PRODUCT_DELETE_ROLES.has(role ?? "");

  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductItem | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [manufacturers, setManufacturers] = useState<ManufacturerItem[]>([]);
  const [addingManufacturer, setAddingManufacturer] = useState(false);
  const [newManufacturerName, setNewManufacturerName] = useState("");
  const [addingManufacturerSaving, setAddingManufacturerSaving] =
    useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [showInactive]);

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

  useEffect(() => {
    if (!modalOpen || !token) return;
    let cancelled = false;
    void (async () => {
      try {
        const { manufacturers: list } = await getManufacturers(token);
        if (cancelled) return;
        setManufacturers(list);
        setForm((prev) => {
          if (
            prev.manufacturer &&
            list.some((m) => m._id === prev.manufacturer)
          ) {
            return prev;
          }
          return { ...prev, manufacturer: defaultManufacturerId(list) };
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError
            ? err.message
            : "Failed to load manufacturers.",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, token]);

  const visible = useMemo(() => products, [products]);
  const { safePage, totalPages, rangeStart, rangeEnd } = paginationRange(
    page,
    pageSize,
    visible.length,
  );
  const paged = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return visible.slice(start, start + pageSize);
  }, [visible, safePage, pageSize]);
  const paginationProps = {
    rangeStart,
    rangeEnd,
    total: visible.length,
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

  function resetManufacturerAdd() {
    setAddingManufacturer(false);
    setNewManufacturerName("");
    setAddingManufacturerSaving(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_PRODUCT_FORM);
    resetManufacturerAdd();
    setModalOpen(true);
  }

  function openEdit(product: ProductItem) {
    setEditing(product);
    setForm({
      productCode: productCodeOf(product),
      productNumber: uppercaseText(product.productNumber ?? ""),
      name: uppercaseText(product.name),
      manufacturer: product.manufacturer?._id ?? "",
      kind: product.kind === "labor" ? "labor" : "part",
      listPrice: moneyString(listPriceOf(product)),
      cost: moneyString(product.cost ?? 0),
      strikeThroughPrice:
        product.strikeThroughPrice > 0
          ? moneyString(product.strikeThroughPrice)
          : "",
      active: product.active,
      notes: uppercaseText(product.notes ?? ""),
    });
    resetManufacturerAdd();
    setModalOpen(true);
  }

  async function handleAddManufacturer() {
    if (!token) return;
    const name = uppercaseText(newManufacturerName.trim());
    if (!name) return;
    setAddingManufacturerSaving(true);
    setError(null);
    try {
      const { manufacturer } = await createManufacturer(token, { name });
      setManufacturers((prev) =>
        prev.some((m) => m._id === manufacturer._id)
          ? prev
          : [...prev, manufacturer].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
            ),
      );
      setForm((prev) => ({ ...prev, manufacturer: manufacturer._id }));
      resetManufacturerAdd();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to add manufacturer.",
      );
      setAddingManufacturerSaving(false);
    }
  }

  async function handleSave() {
    if (!token) return;
    setSaving(true);
    setError(null);
    try {
      const payload = toProductWritePayload(form);
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
    const code = productCodeOf(product);
    if (!window.confirm(`Delete product ${code}?`)) return;
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
            Parts and labor used on estimates and work orders.
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
            placeholder="Search product code, number, alt code, or name"
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
                Add parts and labor so they can be picked on estimates and work orders.
              </p>
              {canWrite ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  <Plus className="h-4 w-4" />
                  Add product
                </button>
              ) : null}
            </div>
          }
          mobile={
            <div className="space-y-3">
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                <TablePagination {...paginationProps} position="top" />
              </div>
              {paged.map((product) => (
            <MobileDataCard
              key={product._id}
              title={productCodeOf(product)}
              subtitle={product.name}
              badges={
                <span className="flex flex-wrap gap-1">
                  <KindBadge kind={product.kind === "labor" ? "labor" : "part"} />
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                      product.active
                        ? "bg-green-50 text-green-700 ring-1 ring-inset ring-green-600/20"
                        : "bg-neutral-100 text-neutral-500 ring-1 ring-inset ring-neutral-300"
                    }`}
                  >
                    {product.active ? "Active" : "Inactive"}
                  </span>
                </span>
              }
              fields={
                <>
                  <DataField
                    label="List price"
                    value={
                      <PriceDisplay
                        listPrice={listPriceOf(product)}
                        strikeThroughPrice={product.strikeThroughPrice}
                      />
                    }
                  />
                  <DataField
                    label="Alt code"
                    value={(product.productAltCode || "—").toUpperCase()}
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
                      Product code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      List price
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                      Cost
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
                  {paged.map((product) => (
                    <tr key={product._id} className="hover:bg-neutral-50">
                      <td className="px-6 py-4 font-medium text-brand-dark">
                        <div>{productCodeOf(product)}</div>
                        {product.productAltCode ? (
                          <div className="text-xs font-normal text-neutral-400">
                            {product.productAltCode.toUpperCase()}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-6 py-4 text-neutral-600">{product.name}</td>
                      <td className="px-6 py-4">
                        <KindBadge kind={product.kind === "labor" ? "labor" : "part"} />
                      </td>
                      <td className="px-6 py-4 text-neutral-700">
                        <PriceDisplay
                          listPrice={listPriceOf(product)}
                          strikeThroughPrice={product.strikeThroughPrice}
                        />
                      </td>
                      <td className="px-6 py-4 text-neutral-700">
                        {formatMoney(product.cost ?? 0)}
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
              <TablePagination {...paginationProps} position="bottom" />
            </div>
          }
        />
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white p-6 shadow-xl sm:max-w-xl sm:rounded-xl">
            <h2 className="text-lg font-semibold text-brand-dark">
              {editing ? "Edit product" : "Add product"}
            </h2>
            <p className="mt-1 text-xs text-neutral-500">
              <span className="font-medium text-red-600">*</span> Required
            </p>
            <div className="mt-4">
              <ProductEditorFields
                form={form}
                onChange={(updates) =>
                  setForm((prev) => ({ ...prev, ...updates }))
                }
                manufacturers={manufacturers}
                addingManufacturer={addingManufacturer}
                newManufacturerName={newManufacturerName}
                addingManufacturerSaving={addingManufacturerSaving}
                onStartAddManufacturer={() => {
                  setAddingManufacturer(true);
                  setNewManufacturerName("");
                }}
                onCancelAddManufacturer={resetManufacturerAdd}
                onNewManufacturerNameChange={setNewManufacturerName}
                onAddManufacturer={() => void handleAddManufacturer()}
              />
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
                disabled={saving || !isProductFormComplete(form, addingManufacturer)}
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
