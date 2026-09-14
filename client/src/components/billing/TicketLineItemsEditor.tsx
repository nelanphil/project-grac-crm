"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import {
  ApiError,
  ProductItem,
  ProductKind,
  createProduct,
  getProducts,
} from "@/lib/api";
import {
  DEFAULT_PRODUCT_DISCOUNTS,
  discountedUnitPrice,
  type ProductDiscounts,
} from "@/lib/productDiscounts";
import {
  TicketPartRow,
  emptyNoteRow,
  emptyPartRow,
  insertEmptyProductBelow,
  partAmount,
} from "@/lib/service-ticket";
import { useAuthStore } from "@/store/useAuthStore";

const inputClass =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount || 0);
}

function catalogCode(product: ProductItem): string {
  return product.productCode || product.partNumber || "";
}

function catalogListPrice(product: ProductItem): number {
  return product.listPrice ?? product.unitPrice ?? 0;
}

function patchRow(
  parts: TicketPartRow[],
  id: string,
  updates: Partial<TicketPartRow>,
): TicketPartRow[] {
  return parts.map((row) => (row.id === id ? { ...row, ...updates } : row));
}

function ProductSuggestMenu({
  anchor,
  products,
  discounts,
  searchQuery,
  canCreate,
  onSelect,
  onCreate,
  onClose,
}: {
  anchor: HTMLElement | null;
  products: ProductItem[];
  discounts: ProductDiscounts;
  searchQuery: string;
  canCreate: boolean;
  onSelect: (product: ProductItem) => void;
  onCreate: (code: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLUListElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    if (!anchor) return;
    function update() {
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const gutter = 8;
      const spaceBelow = window.innerHeight - rect.bottom - gutter;
      const spaceAbove = rect.top - gutter;
      const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(256, Math.max(openUp ? spaceAbove : spaceBelow, 120));
      const width = Math.min(
        Math.max(rect.width, 240),
        window.innerWidth - gutter * 2,
      );
      const left = Math.min(
        Math.max(gutter, rect.left),
        window.innerWidth - width - gutter,
      );
      setCoords({
        top: openUp ? Math.max(gutter, rect.top - maxHeight - 4) : rect.bottom + 4,
        left,
        width,
        maxHeight,
      });
    }
    update();
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [anchor, products.length]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (anchor?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchor, onClose]);

  const query = searchQuery.trim();
  const queryCode = query.replace(/\s+/g, "").toUpperCase();
  const exactMatch = products.some((product) => catalogCode(product).toUpperCase() === queryCode);
  const showCreate = canCreate && queryCode.length > 0 && !exactMatch;

  if (!coords || (products.length === 0 && !showCreate)) return null;

  return createPortal(
    <ul
      ref={menuRef}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        width: coords.width,
        maxHeight: coords.maxHeight,
        zIndex: 80,
      }}
      className="overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg"
    >
      {products.map((product) => {
        const listPrice = catalogListPrice(product);
        const kind = product.kind === "labor" ? "labor" : "part";
        const unitPrice = discountedUnitPrice(listPrice, kind, discounts);
        const strike = product.strikeThroughPrice > 0;
        return (
          <li key={product._id}>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onSelect(product)}
              className="w-full px-3 py-2 text-left text-xs hover:bg-neutral-50"
            >
              <span className="font-medium">{catalogCode(product)}</span>
              <span className="ml-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-600">
                {kind === "labor" ? "Labor" : "Part"}
              </span>
              <span className="mt-0.5 block text-neutral-500">
                {product.name} ·{" "}
                {strike ? (
                  <span className="mr-1 text-neutral-400 line-through">
                    {formatMoney(product.strikeThroughPrice)}
                  </span>
                ) : null}
                {unitPrice < listPrice ? (
                  <>
                    <span className="mr-1 text-neutral-400 line-through">
                      {formatMoney(listPrice)}
                    </span>
                    {formatMoney(unitPrice)}
                  </>
                ) : (
                  formatMoney(listPrice)
                )}
              </span>
            </button>
          </li>
        );
      })}
      {showCreate ? (
        <li className={products.length ? "border-t border-neutral-100" : ""}>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onCreate(queryCode)}
            className="w-full px-3 py-2 text-left text-xs text-brand-blue hover:bg-sky-50"
          >
            Create product <span className="font-semibold">{queryCode}</span>
          </button>
        </li>
      ) : null}
    </ul>,
    document.body,
  );
}

function isEmptyLine(row: TicketPartRow): boolean {
  return !row.partNumber.trim() && !row.description.trim();
}

function LineRemoveConfirm({
  label,
  onCancel,
  onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-start gap-2 text-xs">
      <p className="text-red-700">{label}</p>
      <button
        type="button"
        onClick={onCancel}
        className="rounded border border-neutral-300 px-2 py-1 font-medium text-neutral-600 hover:bg-neutral-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onConfirm}
        className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
      >
        Remove
      </button>
    </div>
  );
}

function CreateProductDialog({
  initialCode,
  onClose,
  onCreated,
}: {
  initialCode: string;
  onClose: () => void;
  onCreated: (product: ProductItem) => void;
}) {
  const token = useAuthStore((s) => s.token);
  const [productCode, setProductCode] = useState(initialCode);
  const [name, setName] = useState(initialCode);
  const [kind, setKind] = useState<ProductKind>("part");
  const [listPrice, setListPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!token) return;
    const code = productCode.replace(/\s+/g, "").toUpperCase();
    const productName = name.trim().toUpperCase() || code;
    if (!code || !productName) {
      setError("Product code and name are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { product } = await createProduct(token, {
        productCode: code,
        name: productName,
        kind,
        listPrice: Number(listPrice) || 0,
      });
      onCreated(product);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to create product.",
      );
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40 sm:items-center">
      <div className="w-full rounded-t-xl bg-white p-5 shadow-xl sm:max-w-md sm:rounded-xl">
        <h2 className="text-base font-semibold text-brand-dark">
          Add product code
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          This saves to the product catalog and adds it to the current line.
        </p>
        <div className="mt-4 grid gap-3">
          <label className="block text-xs">
            <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
              Product code
            </span>
            <input
              value={productCode}
              onChange={(e) => setProductCode(e.target.value.toUpperCase())}
              className={inputClass}
            />
          </label>
          <label className="block text-xs">
            <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.toUpperCase())}
              className={inputClass}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
                Type
              </span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as ProductKind)}
                className={inputClass}
              >
                <option value="part">Part</option>
                <option value="labor">Labor</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="mb-1 block font-semibold uppercase tracking-wide text-neutral-500">
                Price
              </span>
              <input
                value={listPrice}
                onChange={(e) => setListPrice(e.target.value)}
                inputMode="decimal"
                className={inputClass}
              />
            </label>
          </div>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-700">{error}</p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSubmit()}
            className="rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Add product"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function SortableLineRow({
  row,
  productResults,
  isActiveSearch,
  pendingFocus,
  discounts,
  searchQuery,
  canCreate,
  onFocusSearch,
  onCloseSearch,
  onChange,
  onRemove,
  onCreateProduct,
}: {
  row: TicketPartRow;
  productResults: ProductItem[];
  isActiveSearch: boolean;
  pendingFocus: boolean;
  discounts: ProductDiscounts;
  searchQuery: string;
  canCreate: boolean;
  onFocusSearch: () => void;
  onCloseSearch: () => void;
  onChange: (updates: Partial<TicketPartRow>, searchQuery?: string) => void;
  onRemove: () => void;
  onCreateProduct: (code: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.id });
  const searchRef = useRef<HTMLInputElement>(null);
  const didFocus = useRef(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLInputElement | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  function requestRemove() {
    if (isEmptyLine(row)) {
      onRemove();
      return;
    }
    setConfirmingRemove(true);
  }

  useEffect(() => {
    if (pendingFocus && !didFocus.current) {
      didFocus.current = true;
      searchRef.current?.focus();
    }
  }, [pendingFocus]);

  useEffect(() => {
    setMenuAnchor(isActiveSearch ? searchRef.current : null);
  }, [isActiveSearch]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.65 : 1,
  };

  const confirmRow = confirmingRemove ? (
    <tr className="border-t border-red-100 bg-red-50">
      <td colSpan={5} className="px-3 py-2">
        <LineRemoveConfirm
          label={
            row.lineType === "note"
              ? "Remove this line note?"
              : "Remove this product?"
          }
          onCancel={() => setConfirmingRemove(false)}
          onConfirm={onRemove}
        />
      </td>
    </tr>
  ) : null;

  if (row.lineType === "note") {
    return (
      <>
        <tr ref={setNodeRef} style={style} className="border-t border-neutral-100 bg-neutral-50/60">
          <td className="px-1 py-1">
            <button
              type="button"
              className="cursor-grab touch-none rounded p-1 text-neutral-400 hover:text-neutral-600"
              aria-label="Reorder note"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          </td>
          <td className="px-2 py-1 text-xs text-neutral-400">Note</td>
          <td className="px-2 py-1" colSpan={2}>
            <textarea
              rows={2}
              value={row.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Line note"
              className={inputClass}
            />
          </td>
          <td className="px-1 py-1 text-right">
            <button
              type="button"
              onClick={requestRemove}
              className="rounded p-1 text-neutral-400 hover:text-red-600"
              aria-label="Remove note"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </td>
        </tr>
        {confirmRow}
      </>
    );
  }

  return (
    <>
      <tr ref={setNodeRef} style={style} className="border-t border-neutral-100">
        <td className="px-1 py-1">
          <button
            type="button"
            className="cursor-grab touch-none rounded p-1 text-neutral-400 hover:text-neutral-600"
            aria-label="Reorder product"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </td>
        <td className="w-16 px-2 py-1">
          <input
            value={row.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            className={inputClass}
          />
        </td>
        <td className="relative px-2 py-1">
          <input
            ref={searchRef}
            value={row.partNumber}
            onFocus={onFocusSearch}
            onChange={(e) =>
              onChange(
                {
                  partNumber: e.target.value,
                  productRef: "",
                },
                e.target.value,
              )
            }
            className={inputClass}
            placeholder="Search products"
          />
          {row.description ? (
            <p className="mt-0.5 text-[11px] text-neutral-500">
              {row.kind === "labor" ? "Labor · " : ""}
              {row.description}
            </p>
          ) : null}
          {isActiveSearch && (productResults.length > 0 || canCreate) ? (
            <ProductSuggestMenu
              anchor={menuAnchor}
              products={productResults}
              discounts={discounts}
              searchQuery={searchQuery || row.partNumber}
              canCreate={canCreate}
              onClose={onCloseSearch}
              onCreate={onCreateProduct}
              onSelect={(product) => {
                const listPrice = catalogListPrice(product);
                const kind = product.kind === "labor" ? "labor" : "part";
                onChange({
                  productRef: product._id,
                  partNumber: catalogCode(product),
                  description: product.name,
                  kind,
                  quantity: row.quantity || "1",
                  listPrice: String(listPrice),
                  unitPrice: String(discountedUnitPrice(listPrice, kind, discounts)),
                  priceOverridden: false,
                });
              }}
            />
          ) : null}
        </td>
        <td className="w-28 px-2 py-1">
          <input
            value={row.unitPrice}
            onChange={(e) =>
              onChange({ unitPrice: e.target.value, priceOverridden: true })
            }
            className={inputClass}
          />
          <p className="mt-0.5 text-[10px] text-neutral-400">
            Line {formatMoney(partAmount(row))}
            {row.priceOverridden ? " · override" : ""}
          </p>
        </td>
        <td className="px-1 py-1 text-right">
          <button
            type="button"
            onClick={requestRemove}
            className="rounded p-1 text-neutral-400 hover:text-red-600"
            aria-label="Remove product"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </td>
      </tr>
      {confirmRow}
    </>
  );
}

export default function TicketLineItemsEditor({
  parts,
  onChange,
  discounts,
  banner,
}: {
  parts: TicketPartRow[];
  onChange: (parts: TicketPartRow[]) => void;
  discounts?: ProductDiscounts;
  banner?: ReactNode;
}) {
  const token = useAuthStore((s) => s.token);
  const canCreateProduct = useAuthStore(
    (s) =>
      s.hasPermission("products:write") ||
      s.hasPermission("estimates:write") ||
      s.hasPermission("jobs:write"),
  );
  const [productQuery, setProductQuery] = useState<Record<string, string>>({});
  const [productResults, setProductResults] = useState<ProductItem[]>([]);
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<{ rowId: string; code: string } | null>(
    null,
  );
  const discountRules = discounts ?? DEFAULT_PRODUCT_DISCOUNTS;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    if (!token || activePartId == null) return;
    const q = (productQuery[activePartId] ?? "").trim();
    const t = setTimeout(() => {
      getProducts(token, {
        search: q || undefined,
        active: true,
      })
        .then(({ products }) => setProductResults(products.slice(0, 12)))
        .catch(() => setProductResults([]));
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [token, activePartId, productQuery]);

  function addProductRow() {
    const row = emptyPartRow();
    onChange([...parts, row]);
    setPendingFocusId(row.id);
    setActivePartId(row.id);
  }

  function addNoteRow() {
    onChange([...parts, emptyNoteRow()]);
  }

  function applyProductToRow(id: string, product: ProductItem) {
    const listPrice = catalogListPrice(product);
    const kind = product.kind === "labor" ? "labor" : "part";
    updatePart(id, {
      productRef: product._id,
      partNumber: catalogCode(product),
      description: product.name,
      kind,
      quantity:
        parts.find((row) => row.id === id)?.quantity || "1",
      listPrice: String(listPrice),
      unitPrice: String(discountedUnitPrice(listPrice, kind, discountRules)),
      priceOverridden: false,
    });
  }

  function updatePart(
    id: string,
    updates: Partial<TicketPartRow>,
    searchQuery?: string,
  ) {
    let next = patchRow(parts, id, updates);
    if (searchQuery !== undefined) {
      setProductQuery((prev) => ({ ...prev, [id]: searchQuery }));
    }
    if (updates.productRef) {
      const inserted = insertEmptyProductBelow(next, id);
      next = inserted.parts;
      setActivePartId(inserted.emptyId);
      setPendingFocusId(inserted.emptyId);
      setProductResults([]);
      setCreateFor(null);
    }
    onChange(next);
  }

  function removePart(id: string) {
    onChange(parts.filter((row) => row.id !== id));
    if (activePartId === id) {
      setActivePartId(null);
      setProductResults([]);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = parts.findIndex((row) => row.id === active.id);
    const newIndex = parts.findIndex((row) => row.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = [...parts];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    onChange(next);
  }

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Parts & Labor
        </p>
        {banner}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addProductRow}
            className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add product
          </button>
          <button
            type="button"
            onClick={addNoteRow}
            className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add note
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded border border-neutral-200">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table className="min-w-full text-sm">
            <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
              <tr>
                <th className="w-8 px-1 py-2" />
                <th className="w-16 px-2 py-2 text-left">Qty</th>
                <th className="px-2 py-2 text-left">Product</th>
                <th className="w-28 px-2 py-2 text-left">Amount</th>
                <th className="w-8 px-1 py-2" />
              </tr>
            </thead>
            <SortableContext
              items={parts.map((row) => row.id)}
              strategy={verticalListSortingStrategy}
            >
              <tbody>
                {parts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-sm text-neutral-400"
                    >
                      Add parts or labor from the product catalog.
                    </td>
                  </tr>
                ) : (
                  parts.map((row) => (
                    <SortableLineRow
                      key={row.id}
                      row={row}
                      productResults={productResults}
                      isActiveSearch={activePartId === row.id}
                      pendingFocus={pendingFocusId === row.id}
                      discounts={discountRules}
                      searchQuery={productQuery[row.id] ?? row.partNumber}
                      canCreate={canCreateProduct}
                      onFocusSearch={() => setActivePartId(row.id)}
                      onCloseSearch={() => {
                        if (activePartId === row.id) {
                          setActivePartId(null);
                          setProductResults([]);
                        }
                      }}
                      onChange={(updates, searchQuery) =>
                        updatePart(row.id, updates, searchQuery)
                      }
                      onRemove={() => removePart(row.id)}
                      onCreateProduct={(code) => {
                        setCreateFor({ rowId: row.id, code });
                        setActivePartId(null);
                        setProductResults([]);
                      }}
                    />
                  ))
                )}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>
      {createFor ? (
        <CreateProductDialog
          initialCode={createFor.code}
          onClose={() => setCreateFor(null)}
          onCreated={(product) => applyProductToRow(createFor.rowId, product)}
        />
      ) : null}
    </div>
  );
}
