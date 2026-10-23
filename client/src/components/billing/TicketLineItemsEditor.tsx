"use client";

import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
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
  ContractTemplateItem,
  ManufacturerItem,
  ProductItem,
  createManufacturer,
  createProduct,
  getContractTemplates,
  getManufacturers,
  getProducts,
} from "@/lib/api";
import ProductEditorFields, {
  EMPTY_PRODUCT_FORM,
  defaultManufacturerId,
  isProductFormComplete,
  normalizeProductCode,
  toProductWritePayload,
  uppercaseText,
  type ProductFormState,
} from "@/components/products/ProductEditorFields";
import {
  DEFAULT_PRODUCT_DISCOUNTS,
  discountedUnitPrice,
  type ProductDiscounts,
} from "@/lib/productDiscounts";
import {
  TicketPartRow,
  emptyAgreementRow,
  emptyNoteRow,
  emptyPartRow,
  insertEmptyProductBelow,
  partAmount,
  ticketProductKindPrefix,
} from "@/lib/service-ticket";
import { useAuthStore } from "@/store/useAuthStore";

const inputClass =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-base text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue sm:text-sm";
const SM_UP_QUERY = "(min-width: 640px)";
const SUGGEST_KIND_PILL =
  "ml-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase text-neutral-600";
const SUGGEST_ROW_BUTTON =
  "flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-neutral-50 sm:text-xs";

function useMinWidth(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : true,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

function subscribeViewport(onChange: () => void) {
  window.addEventListener("scroll", onChange, true);
  window.addEventListener("resize", onChange);
  const viewport = window.visualViewport;
  viewport?.addEventListener("resize", onChange);
  viewport?.addEventListener("scroll", onChange);
  return () => {
    window.removeEventListener("scroll", onChange, true);
    window.removeEventListener("resize", onChange);
    viewport?.removeEventListener("resize", onChange);
    viewport?.removeEventListener("scroll", onChange);
  };
}

function useSuggestPopoverCoords(anchor: HTMLElement | null, extraKey: number) {
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
      const viewport = window.visualViewport;
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const offsetTop = viewport?.offsetTop ?? 0;
      const viewWidth = viewport?.width ?? window.innerWidth;
      const viewHeight = viewport?.height ?? window.innerHeight;
      const gutter = 8;
      const spaceBelow = offsetTop + viewHeight - rect.bottom - gutter;
      const spaceAbove = rect.top - offsetTop - gutter;
      const openUp = spaceBelow < 140 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(256, Math.max(openUp ? spaceAbove : spaceBelow, 120));
      const width = Math.min(
        Math.max(rect.width, 240),
        viewWidth - gutter * 2,
      );
      const left = Math.min(
        Math.max(offsetLeft + gutter, rect.left),
        offsetLeft + viewWidth - width - gutter,
      );
      setCoords({
        top: openUp
          ? Math.max(offsetTop + gutter, rect.top - maxHeight - 4)
          : rect.bottom + 4,
        left,
        width,
        maxHeight,
      });
    }
    update();
    return subscribeViewport(update);
  }, [anchor, extraKey]);

  return coords;
}

function useBodyScrollLock(
  locked: boolean,
  allowScroll: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!locked) return;
    const html = document.documentElement;
    const { body } = document;
    const scrollY = window.scrollY;
    const previous = {
      htmlOverflow: html.style.overflow,
      htmlOverscroll: html.style.overscrollBehavior,
      bodyOverflow: body.style.overflow,
      bodyOverscroll: body.style.overscrollBehavior,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
    };

    html.style.overflow = "hidden";
    html.style.overscrollBehavior = "none";
    body.style.overflow = "hidden";
    body.style.overscrollBehavior = "none";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    function preventBackgroundTouch(event: TouchEvent) {
      const target = event.target;
      const sheet = allowScroll.current;
      if (
        target instanceof Element &&
        (sheet?.contains(target) ||
          target.closest("input, textarea, [contenteditable='true']"))
      ) {
        return;
      }
      event.preventDefault();
    }

    document.addEventListener("touchmove", preventBackgroundTouch, {
      passive: false,
    });

    return () => {
      html.style.overflow = previous.htmlOverflow;
      html.style.overscrollBehavior = previous.htmlOverscroll;
      body.style.overflow = previous.bodyOverflow;
      body.style.overscrollBehavior = previous.bodyOverscroll;
      body.style.position = previous.bodyPosition;
      body.style.top = previous.bodyTop;
      body.style.left = previous.bodyLeft;
      body.style.right = previous.bodyRight;
      body.style.width = previous.bodyWidth;
      document.removeEventListener("touchmove", preventBackgroundTouch);
      window.scrollTo(0, scrollY);
    };
  }, [locked, allowScroll]);
}

function useSheetViewportStyle(enabled: boolean): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({
    bottom: 0,
    maxHeight: "60vh",
  });

  useEffect(() => {
    if (!enabled) return;
    function update() {
      const viewport = window.visualViewport;
      if (!viewport) {
        setStyle({ bottom: 0, maxHeight: "60vh" });
        return;
      }
      const keyboardInset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      setStyle({
        bottom: keyboardInset,
        maxHeight: Math.min(viewport.height * 0.6, viewport.height),
      });
    }
    update();
    return subscribeViewport(update);
  }, [enabled]);

  return style;
}

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

function ticketFieldsForProduct(
  product: ProductItem,
  quantity: string,
  discounts: ProductDiscounts,
): Partial<TicketPartRow> {
  const listPrice = catalogListPrice(product);
  const qty = quantity || "1";
  if (product.kind === "contract") {
    return {
      lineType: "agreement",
      productRef: "",
      contractTemplateRef: product.contractTemplateRef ?? "",
      enrolledContractRef: "",
      partNumber: "",
      description: product.name,
      kind: "part",
      quantity: qty,
      listPrice: String(listPrice),
      unitPrice: String(listPrice),
      priceOverridden: false,
    };
  }
  const kind =
    product.kind === "labor"
      ? "labor"
      : product.kind === "equipment"
        ? "equipment"
        : "part";
  return {
    lineType: "product",
    productRef: product._id,
    contractTemplateRef: "",
    enrolledContractRef: "",
    partNumber: catalogCode(product),
    description: product.name,
    kind,
    quantity: qty,
    listPrice: String(listPrice),
    unitPrice: String(
      discountedUnitPrice(listPrice, kind === "labor" ? "labor" : "part", discounts),
    ),
    priceOverridden: false,
  };
}

function patchRow(
  parts: TicketPartRow[],
  id: string,
  updates: Partial<TicketPartRow>,
): TicketPartRow[] {
  return parts.map((row) => (row.id === id ? { ...row, ...updates } : row));
}

function productKindLabel(product: ProductItem): string {
  if (product.kind === "labor") return "Labor";
  if (product.kind === "equipment") return "Equipment";
  if (product.kind === "contract") return "Contract";
  return "Part";
}

function SuggestPrice({
  listPrice,
  unitPrice,
  strikeThroughPrice = 0,
}: {
  listPrice: number;
  unitPrice: number;
  strikeThroughPrice?: number;
}) {
  return (
    <span className="shrink-0 text-right tabular-nums font-medium">
      {strikeThroughPrice > 0 ? (
        <span className="block text-neutral-400 line-through">
          {formatMoney(strikeThroughPrice)}
        </span>
      ) : null}
      {unitPrice < listPrice ? (
        <span className="block text-neutral-400 line-through">
          {formatMoney(listPrice)}
        </span>
      ) : null}
      <span className="block">
        {formatMoney(unitPrice < listPrice ? unitPrice : listPrice)}
      </span>
    </span>
  );
}

function SuggestResultButton({
  code,
  kindLabel,
  name,
  price,
  onSelect,
}: {
  code: string;
  kindLabel: string;
  name?: string;
  price: ReactNode;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={SUGGEST_ROW_BUTTON}
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium">{code}</span>
        <span className={SUGGEST_KIND_PILL}>{kindLabel}</span>
        {name ? (
          <span className="mt-0.5 block text-neutral-600 line-clamp-2 break-words">
            {name}
          </span>
        ) : null}
      </span>
      {price}
    </button>
  );
}

function SuggestStatusRow({ children }: { children: ReactNode }) {
  return (
    <li
      className="px-3 py-2.5 text-sm text-neutral-500 sm:text-xs"
      aria-live="polite"
    >
      {children}
    </li>
  );
}

function isSmUpViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(SM_UP_QUERY).matches;
}

function SuggestMenuFrame({
  anchor,
  extraKey,
  label,
  searchQuery,
  searchPlaceholder,
  empty,
  onQueryChange,
  onClose,
  children,
}: {
  anchor: HTMLElement | null;
  extraKey: number;
  label: string;
  searchQuery: string;
  searchPlaceholder: string;
  empty: boolean;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const isSmUp = useMinWidth(SM_UP_QUERY);
  const coords = useSuggestPopoverCoords(isSmUp ? anchor : null, extraKey);
  const menuRef = useRef<HTMLElement | null>(null);
  const sheetInputRef = useRef<HTMLInputElement>(null);
  const sheetOpen = !isSmUp;
  const sheetStyle = useSheetViewportStyle(sheetOpen);
  useBodyScrollLock(sheetOpen, menuRef);

  useEffect(() => {
    if (isSmUp) return;
    sheetInputRef.current?.focus();
  }, [isSmUp]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (anchor?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchor, onClose]);

  if (typeof document === "undefined") return null;
  if (isSmUp && (empty || !coords)) return null;

  if (!isSmUp) {
    return createPortal(
      <>
        <div
          className="fixed inset-0 z-[90] touch-none bg-black/40"
          onClick={onClose}
          aria-hidden
        />
        <div
          ref={(node) => {
            menuRef.current = node;
          }}
          role="dialog"
          aria-label={label}
          className="fixed inset-x-0 bottom-0 z-[90] max-h-[60vh] overflow-y-auto overscroll-contain rounded-t-xl bg-white shadow-xl pb-[env(safe-area-inset-bottom)]"
          style={sheetStyle}
        >
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-[var(--staff-border)] bg-white px-3 py-2">
            <input
              ref={sheetInputRef}
              value={searchQuery}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className={inputClass}
            />
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
            >
              Close
            </button>
          </div>
          <ul>{children}</ul>
        </div>
      </>,
      document.body,
    );
  }

  return createPortal(
    <ul
      ref={(node) => {
        menuRef.current = node;
      }}
      style={{
        position: "fixed",
        top: coords?.top,
        left: coords?.left,
        width: coords?.width,
        maxHeight: coords?.maxHeight,
        zIndex: 80,
      }}
      className="overflow-auto rounded-md border border-neutral-200 bg-white shadow-lg"
    >
      {children}
    </ul>,
    document.body,
  );
}

function ProductSuggestMenu({
  anchor,
  products,
  discounts,
  searchQuery,
  canCreate,
  loading,
  onQueryChange,
  onSelect,
  onCreate,
  onClose,
}: {
  anchor: HTMLElement | null;
  products: ProductItem[];
  discounts: ProductDiscounts;
  searchQuery: string;
  canCreate: boolean;
  loading: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (product: ProductItem) => void;
  onCreate: (code: string) => void;
  onClose: () => void;
}) {
  const query = searchQuery.trim();
  const queryCode = query.replace(/\s+/g, "").toUpperCase();
  const exactMatch = products.some(
    (product) => catalogCode(product).toUpperCase() === queryCode,
  );
  const showCreate = canCreate && queryCode.length > 0 && !exactMatch;

  return (
    <SuggestMenuFrame
      anchor={anchor}
      extraKey={products.length}
      label="Product search results"
      searchQuery={searchQuery}
      searchPlaceholder="Search products"
      empty={!loading && products.length === 0 && !showCreate}
      onQueryChange={onQueryChange}
      onClose={onClose}
    >
      {loading && products.length === 0 ? (
        <SuggestStatusRow>Searching…</SuggestStatusRow>
      ) : !loading && products.length === 0 ? (
        <SuggestStatusRow>No matches</SuggestStatusRow>
      ) : null}
      {products.map((product) => {
        const listPrice = catalogListPrice(product);
        const unitPrice =
          product.kind === "contract"
            ? listPrice
            : discountedUnitPrice(
                listPrice,
                product.kind === "labor" ? "labor" : "part",
                discounts,
              );
        return (
          <li key={product._id}>
            <SuggestResultButton
              code={catalogCode(product)}
              kindLabel={productKindLabel(product)}
              name={product.name}
              onSelect={() => onSelect(product)}
              price={
                <SuggestPrice
                  listPrice={listPrice}
                  unitPrice={unitPrice}
                  strikeThroughPrice={product.strikeThroughPrice}
                />
              }
            />
          </li>
        );
      })}
      {showCreate ? (
        <li className={products.length ? "border-t border-neutral-100" : ""}>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onCreate(queryCode)}
            className="flex min-h-11 w-full items-start justify-between gap-3 px-3 py-2.5 text-left text-sm text-brand-blue hover:bg-sky-50 sm:text-xs"
          >
            <span>
              Create product <span className="font-semibold">{queryCode}</span>
            </span>
          </button>
        </li>
      ) : null}
    </SuggestMenuFrame>
  );
}

function isEmptyLine(row: TicketPartRow): boolean {
  if (row.lineType === "agreement") {
    return !row.contractTemplateRef.trim() && !row.description.trim();
  }
  return !row.partNumber.trim() && !row.description.trim();
}

function AgreementSuggestMenu({
  anchor,
  templates,
  searchQuery,
  loading,
  onQueryChange,
  onSelect,
  onClose,
}: {
  anchor: HTMLElement | null;
  templates: ContractTemplateItem[];
  searchQuery: string;
  loading: boolean;
  onQueryChange: (query: string) => void;
  onSelect: (template: ContractTemplateItem) => void;
  onClose: () => void;
}) {
  return (
    <SuggestMenuFrame
      anchor={anchor}
      extraKey={templates.length}
      label="Agreement search results"
      searchQuery={searchQuery}
      searchPlaceholder="Search agreements"
      empty={!loading && templates.length === 0}
      onQueryChange={onQueryChange}
      onClose={onClose}
    >
      {loading ? (
        <SuggestStatusRow>Searching…</SuggestStatusRow>
      ) : templates.length === 0 ? (
        <SuggestStatusRow>No matches</SuggestStatusRow>
      ) : null}
      {templates.map((template) => (
        <li key={template._id}>
          <SuggestResultButton
            code={template.label}
            kindLabel="Agreement"
            onSelect={() => onSelect(template)}
            price={
              <SuggestPrice
                listPrice={template.cost ?? 0}
                unitPrice={template.cost ?? 0}
              />
            }
          />
        </li>
      ))}
    </SuggestMenuFrame>
  );
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
  const [form, setForm] = useState<ProductFormState>({
    ...EMPTY_PRODUCT_FORM,
    productCode: normalizeProductCode(initialCode),
    name: uppercaseText(initialCode),
  });
  const [manufacturers, setManufacturers] = useState<ManufacturerItem[]>([]);
  const [addingManufacturer, setAddingManufacturer] = useState(false);
  const [newManufacturerName, setNewManufacturerName] = useState("");
  const [addingManufacturerSaving, setAddingManufacturerSaving] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
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
  }, [token]);

  function resetManufacturerAdd() {
    setAddingManufacturer(false);
    setNewManufacturerName("");
    setAddingManufacturerSaving(false);
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

  async function handleSubmit() {
    if (!token) return;
    if (!isProductFormComplete(form, addingManufacturer)) {
      setError("Product code, name, manufacturer, and list price are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { product } = await createProduct(token, toProductWritePayload(form));
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
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:max-w-xl sm:rounded-xl">
        <h2 className="text-base font-semibold text-brand-dark">
          Add product
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          This saves to the product catalog and adds it to the current line.
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          <span className="font-medium text-red-600">*</span> Required
        </p>
        <div className="mt-4">
          <ProductEditorFields
            form={form}
            onChange={(updates) => setForm((prev) => ({ ...prev, ...updates }))}
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
            disabled={saving || !isProductFormComplete(form, addingManufacturer)}
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
  agreementResults,
  isActiveSearch,
  pendingFocus,
  discounts,
  searchQuery,
  canCreate,
  productLoading,
  agreementLoading,
  onFocusSearch,
  onCloseSearch,
  onChange,
  onRemove,
  onCreateProduct,
}: {
  row: TicketPartRow;
  productResults: ProductItem[];
  agreementResults: ContractTemplateItem[];
  isActiveSearch: boolean;
  pendingFocus: boolean;
  discounts: ProductDiscounts;
  searchQuery: string;
  canCreate: boolean;
  productLoading: boolean;
  agreementLoading: boolean;
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
              : row.lineType === "agreement"
                ? "Remove this agreement?"
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

  if (row.lineType === "agreement") {
    return (
      <>
        <tr ref={setNodeRef} style={style} className="border-t border-neutral-100">
          <td className="px-1 py-1">
            <button
              type="button"
              className="cursor-grab touch-none rounded p-1 text-neutral-400 hover:text-neutral-600"
              aria-label="Reorder agreement"
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
              value={row.description}
              onFocus={onFocusSearch}
              onChange={(e) =>
                onChange(
                  {
                    description: e.target.value,
                    contractTemplateRef: "",
                    enrolledContractRef: "",
                  },
                  e.target.value,
                )
              }
              className={inputClass}
              placeholder="Search agreements"
            />
            {row.contractTemplateRef ? (
              <p className="mt-0.5 text-[11px] text-neutral-500">Agreement</p>
            ) : null}
            {isActiveSearch ? (
              <AgreementSuggestMenu
                anchor={menuAnchor}
                templates={agreementResults}
                searchQuery={searchQuery || row.description}
                loading={agreementLoading}
                onQueryChange={(query) =>
                  onChange(
                    {
                      description: query,
                      contractTemplateRef: "",
                      enrolledContractRef: "",
                    },
                    query,
                  )
                }
                onClose={onCloseSearch}
                onSelect={(template) => {
                  const cost = template.cost ?? 0;
                  onChange({
                    contractTemplateRef: template._id,
                    enrolledContractRef: "",
                    description: template.label,
                    partNumber: "",
                    productRef: "",
                    kind: "part",
                    quantity: row.quantity || "1",
                    listPrice: String(cost),
                    unitPrice: String(cost),
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
              aria-label="Remove agreement"
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
              {ticketProductKindPrefix(row.kind)}
              {row.description}
            </p>
          ) : null}
          {isActiveSearch ? (
            <ProductSuggestMenu
              anchor={menuAnchor}
              products={productResults}
              discounts={discounts}
              searchQuery={searchQuery || row.partNumber}
              canCreate={canCreate}
              loading={productLoading}
              onQueryChange={(query) =>
                onChange({ partNumber: query, productRef: "" }, query)
              }
              onClose={onCloseSearch}
              onCreate={onCreateProduct}
              onSelect={(product) => {
                onChange(ticketFieldsForProduct(product, row.quantity, discounts));
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
  const [agreementCatalog, setAgreementCatalog] = useState<
    ContractTemplateItem[] | null
  >(null);
  const [activePartId, setActivePartId] = useState<string | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [createFor, setCreateFor] = useState<{ rowId: string; code: string } | null>(
    null,
  );
  const skipSearchFocusId = useRef<string | null>(null);
  const skipSearchFocusTimer = useRef<number | null>(null);
  const [loadedProductKey, setLoadedProductKey] = useState<string | null>(null);
  const discountRules = discounts ?? DEFAULT_PRODUCT_DISCOUNTS;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    return () => {
      if (skipSearchFocusTimer.current != null) {
        window.clearTimeout(skipSearchFocusTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!token || activePartId == null) return;
    const row = parts.find((part) => part.id === activePartId);
    if (!row || row.lineType === "agreement") {
      queueMicrotask(() => setProductResults([]));
      return;
    }
    const q = (productQuery[activePartId] ?? "").trim();
    const requestKey = `${activePartId}:${q}`;
    const t = setTimeout(() => {
      getProducts(token, {
        search: q || undefined,
        active: true,
      })
        .then(({ products }) => {
          setProductResults(products.slice(0, 12));
          setLoadedProductKey(requestKey);
        })
        .catch(() => {
          setProductResults([]);
          setLoadedProductKey(requestKey);
        });
    }, q ? 200 : 0);
    return () => clearTimeout(t);
  }, [token, activePartId, productQuery, parts]);

  useEffect(() => {
    if (!token || activePartId == null || agreementCatalog) return;
    const row = parts.find((part) => part.id === activePartId);
    if (!row || row.lineType !== "agreement") return;
    let cancelled = false;
    getContractTemplates(token)
      .then(({ templates }) => {
        if (!cancelled) {
          setAgreementCatalog(templates.filter((template) => !template.deletedAt));
        }
      })
      .catch(() => {
        if (!cancelled) setAgreementCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token, activePartId, parts, agreementCatalog]);

  function addProductRow() {
    const row = emptyPartRow();
    onChange([...parts, row]);
    setPendingFocusId(row.id);
    setActivePartId(row.id);
  }

  function addNoteRow() {
    onChange([...parts, emptyNoteRow()]);
  }

  function addAgreementRow() {
    const row = emptyAgreementRow();
    onChange([...parts, row]);
    setPendingFocusId(row.id);
    setActivePartId(row.id);
  }

  const activeRow = parts.find((part) => part.id === activePartId);
  const activeProductKey =
    activePartId && activeRow && activeRow.lineType !== "agreement"
      ? `${activePartId}:${(productQuery[activePartId] ?? "").trim()}`
      : null;
  const productLoading =
    activeProductKey != null && loadedProductKey !== activeProductKey;
  const agreementQuery = (
    activePartId ? (productQuery[activePartId] ?? activeRow?.description ?? "") : ""
  )
    .trim()
    .toLowerCase();
  const agreementResults = (agreementCatalog ?? [])
    .filter((template) => {
      if (!agreementQuery) return true;
      return (
        template.label.toLowerCase().includes(agreementQuery) ||
        template.slug.toLowerCase().includes(agreementQuery)
      );
    })
    .slice(0, 12);

  function applyProductToRow(id: string, product: ProductItem) {
    const quantity = parts.find((row) => row.id === id)?.quantity || "1";
    updatePart(id, ticketFieldsForProduct(product, quantity, discountRules));
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
    const selectedAgreement =
      updates.lineType === "agreement" && Boolean(updates.contractTemplateRef);
    if (updates.productRef || selectedAgreement) {
      const inserted = insertEmptyProductBelow(next, id);
      next = inserted.parts;
      setPendingFocusId(inserted.emptyId);
      setProductResults([]);
      setLoadedProductKey(null);
      setCreateFor(null);
      if (isSmUpViewport()) {
        skipSearchFocusId.current = null;
        setActivePartId(inserted.emptyId);
      } else {
        skipSearchFocusId.current = inserted.emptyId;
        setActivePartId(null);
        if (skipSearchFocusTimer.current != null) {
          window.clearTimeout(skipSearchFocusTimer.current);
        }
        skipSearchFocusTimer.current = window.setTimeout(() => {
          if (skipSearchFocusId.current === inserted.emptyId) {
            skipSearchFocusId.current = null;
          }
          skipSearchFocusTimer.current = null;
        }, 400);
      }
    } else if (updates.contractTemplateRef) {
      setActivePartId(null);
      setProductResults([]);
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
          Parts, Labor & Agreements
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
            onClick={addAgreementRow}
            className="inline-flex items-center gap-1 rounded border border-neutral-300 px-2 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
          >
            <Plus className="h-3.5 w-3.5" />
            Add agreement
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
                      Add parts, labor, or agreements.
                    </td>
                  </tr>
                ) : (
                  parts.map((row) => (
                    <SortableLineRow
                      key={row.id}
                      row={row}
                      productResults={productResults}
                      agreementResults={
                        activePartId === row.id ? agreementResults : []
                      }
                      isActiveSearch={activePartId === row.id}
                      pendingFocus={pendingFocusId === row.id}
                      discounts={discountRules}
                      searchQuery={productQuery[row.id] ?? row.partNumber}
                      canCreate={canCreateProduct}
                      productLoading={productLoading}
                      agreementLoading={agreementCatalog == null}
                      onFocusSearch={() => {
                        if (skipSearchFocusId.current === row.id) return;
                        setActivePartId(row.id);
                      }}
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
