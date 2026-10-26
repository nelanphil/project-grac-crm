"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import {
  AlertCircle,
  Clock,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  Printer,
  Wrench,
  X,
} from "lucide-react";
import ServiceTicketDocument, {
  type ServiceTicketView,
} from "@/components/billing/ServiceTicketDocument";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import InvoiceWorkOrderButton from "@/components/billing/InvoiceWorkOrderButton";
import WorkOrderNotesPanel from "@/components/billing/WorkOrderNotesPanel";
import SoftDeleteWarning from "@/components/work-orders/SoftDeleteWarning";
import WorkOrderInvoiceSend from "@/components/dashboard/staff/WorkOrderInvoiceSend";
import {
  ApiError,
  deleteWorkOrder,
  getInvoices,
  getWorkOrder,
  restoreWorkOrder,
  updateWorkOrder,
  type WorkOrderListItem,
} from "@/lib/api";
import { isDispatcherRole, type RoleLike } from "@/lib/dashboard-role";
import { formatLocalClock } from "@/lib/schedule";
import {
  ticketFromRecord,
  ticketToPayload,
  workOrderUpdateBody,
  type TicketFormState,
} from "@/lib/service-ticket";

const DEFAULT_WO_MODAL_WIDTH = 1040;
const DEFAULT_WO_MODAL_HEIGHT = 820;
const MIN_WO_MODAL_WIDTH = 620;
const MIN_WO_MODAL_HEIGHT = 480;
const STORAGE_KEY_WO_MODAL = "grac_work_order_modal_dimensions";

function readModalDimensions(): { width: number; height: number } {
  if (typeof window === "undefined") {
    return { width: DEFAULT_WO_MODAL_WIDTH, height: DEFAULT_WO_MODAL_HEIGHT };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_WO_MODAL);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.width === "number" && typeof parsed?.height === "number") {
        return {
          width: Math.max(
            MIN_WO_MODAL_WIDTH,
            Math.min(window.innerWidth - 32, parsed.width),
          ),
          height: Math.max(
            MIN_WO_MODAL_HEIGHT,
            Math.min(window.innerHeight - 32, parsed.height),
          ),
        };
      }
    }
  } catch {
    // ignore
  }
  return {
    width: Math.min(
      DEFAULT_WO_MODAL_WIDTH,
      Math.max(MIN_WO_MODAL_WIDTH, window.innerWidth - 32),
    ),
    height: Math.min(
      DEFAULT_WO_MODAL_HEIGHT,
      Math.max(MIN_WO_MODAL_HEIGHT, window.innerHeight - 32),
    ),
  };
}

export function ticketViewFromOrder(order: WorkOrderListItem): ServiceTicketView {
  const number = order.number || (order.legacyId ? String(order.legacyId) : "");
  return {
    variant: "work-order",
    number,
    date: order.date,
    tech: order.tech,
    customerName: order.customerName ?? "",
    customerAddress: order.customerAddress ?? "",
    customerCity: order.customerCity ?? "",
    customerState: order.customerState ?? "FL",
    customerZip: order.customerZip ?? "",
    customerPhone: order.customerPhone ?? "",
    customerEmail: order.customerEmail ?? "",
    workPhone: order.workPhone ?? "",
    serialNumber: order.serialNumber ?? "",
    generatorModel: order.generatorModel ?? "",
    exerciseDay: order.exerciseDay ?? "",
    exerciseTime: order.exerciseTime ?? "",
    paid: order.paid,
    runHours: order.runHours,
    laborHours: order.laborHours ?? 0,
    descPerform: order.descPerform,
    descPerformed: order.descPerformed,
    parts: order.parts ?? [],
    totalParts: order.totalParts ?? 0,
    totalLabor: order.totalLabor ?? 0,
    totalAgreements: order.totalAgreements ?? 0,
    miscExp: order.miscExp ?? 0,
    subtotal: order.subtotal ?? 0,
    shipping: order.shipping ?? 0,
    taxRate: order.taxRate ?? 0,
    tax: order.tax ?? 0,
    total: order.total,
    signatureDataUrl: order.signatureDataUrl,
    signedByName: order.signedByName,
    contractDiscount: order.contractDiscount,
  };
}

export type WorkOrderModalProps = {
  workOrderId: string;
  initialOrder?: WorkOrderListItem | null;
  token: string | null;
  user: (RoleLike & { id: string }) | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved?: (order: WorkOrderListItem) => void;
};

export default function WorkOrderModal({
  workOrderId,
  initialOrder,
  token,
  user,
  canWrite,
  onClose,
  onSaved,
}: WorkOrderModalProps) {
  const [order, setOrder] = useState<WorkOrderListItem | null>(initialOrder ?? null);
  const [loading, setLoading] = useState(!initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [invoiceListVersion, setInvoiceListVersion] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // Dynamic modal resizing
  const modalRef = useRef<HTMLDivElement | null>(null);
  const [modalDimensions, setModalDimensions] = useState(readModalDimensions);
  const [isModalMaximized, setIsModalMaximized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  // Fetch complete fresh work order document
  useEffect(() => {
    if (!token || !workOrderId) {
      queueMicrotask(() => setLoading(false));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
    });
    getWorkOrder(token, workOrderId)
      .then((loaded) => {
        if (!cancelled) {
          setOrder(loaded);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          err instanceof ApiError ? err.message : "Failed to load work order details.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, workOrderId]);

  // Fetch linked invoice if available
  useEffect(() => {
    if (!token || !workOrderId) return;
    let cancelled = false;
    getInvoices(token, { workOrderRef: workOrderId })
      .then(({ invoices }) => {
        if (cancelled) return;
        const viewable = invoices.filter((inv) => inv.status !== "void");
        const open = viewable.find((inv) => inv.status === "open");
        setViewInvoiceId((open ?? viewable[0])?._id ?? null);
      })
      .catch(() => {
        if (!cancelled) setViewInvoiceId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, workOrderId, invoiceListVersion]);

  // Keyboard escape listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !confirmingDelete) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, confirmingDelete]);

  // Resizing handler
  const startModalResize = useCallback(
    (e: React.PointerEvent, dir: "e" | "w" | "s" | "n" | "se" | "sw" | "ne" | "nw") => {
      e.preventDefault();
      e.stopPropagation();
      resizeCleanupRef.current?.();

      if (isModalMaximized) {
        setIsModalMaximized(false);
      }

      const modalEl = modalRef.current;
      if (!modalEl) return;

      const rect = modalEl.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      let currentWidth = rect.width;
      let currentHeight = rect.height;

      setIsResizing(true);
      isResizingRef.current = true;

      let cursor = "se-resize";
      if (dir === "e" || dir === "w") cursor = "ew-resize";
      else if (dir === "s" || dir === "n") cursor = "ns-resize";
      else if (dir === "sw" || dir === "ne") cursor = "nesw-resize";
      else if (dir === "se" || dir === "nw") cursor = "nwse-resize";

      const prevCursor = document.body.style.cursor;
      const prevUserSelect = document.body.style.userSelect;
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";

      function onPointerMove(moveEvent: PointerEvent) {
        const maxWidth = Math.max(MIN_WO_MODAL_WIDTH, window.innerWidth - 32);
        const maxHeight = Math.max(MIN_WO_MODAL_HEIGHT, window.innerHeight - 32);

        let nextWidth = currentWidth;
        let nextHeight = currentHeight;

        if (dir.includes("e")) {
          nextWidth = Math.max(
            MIN_WO_MODAL_WIDTH,
            Math.min(maxWidth, (moveEvent.clientX - centerX) * 2),
          );
        } else if (dir.includes("w")) {
          nextWidth = Math.max(
            MIN_WO_MODAL_WIDTH,
            Math.min(maxWidth, (centerX - moveEvent.clientX) * 2),
          );
        }

        if (dir.includes("s")) {
          nextHeight = Math.max(
            MIN_WO_MODAL_HEIGHT,
            Math.min(maxHeight, (moveEvent.clientY - centerY) * 2),
          );
        } else if (dir.includes("n")) {
          nextHeight = Math.max(
            MIN_WO_MODAL_HEIGHT,
            Math.min(maxHeight, (centerY - moveEvent.clientY) * 2),
          );
        }

        currentWidth = nextWidth;
        currentHeight = nextHeight;
        setModalDimensions({
          width: Math.round(nextWidth),
          height: Math.round(nextHeight),
        });
      }

      function onPointerUp() {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
        resizeCleanupRef.current = null;
        setTimeout(() => {
          setIsResizing(false);
          isResizingRef.current = false;
        }, 50);

        try {
          localStorage.setItem(
            STORAGE_KEY_WO_MODAL,
            JSON.stringify({
              width: Math.round(currentWidth),
              height: Math.round(currentHeight),
            }),
          );
        } catch {
          // ignore
        }
      }

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      resizeCleanupRef.current = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        document.body.style.cursor = prevCursor;
        document.body.style.userSelect = prevUserSelect;
      };
    },
    [isModalMaximized],
  );

  async function handleAutoSave(
    payload: ReturnType<typeof ticketToPayload>,
  ): Promise<TicketFormState> {
    if (!token || !order) throw new Error("Work order is not loaded.");
    const updated = await updateWorkOrder(
      token,
      order._id,
      workOrderUpdateBody(payload, order, Boolean(user && isDispatcherRole(user))),
    );
    setOrder(updated);
    onSaved?.(updated);
    return ticketFromRecord(updated);
  }

  async function handleSubmit(
    payload: ReturnType<typeof ticketToPayload> & { scheduleInsertIndex?: number },
  ) {
    if (!token || !order) return;
    const updated = await updateWorkOrder(
      token,
      order._id,
      workOrderUpdateBody(payload, order, Boolean(user && isDispatcherRole(user))),
    );
    setOrder(updated);
    onSaved?.(updated);
  }

  const orderNumber =
    order?.number || (order?.legacyId ? String(order.legacyId) : "");
  const time = order?.scheduledStart
    ? formatLocalClock(new Date(order.scheduledStart))
    : order?.startTime || "";

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs"
      onClick={() => {
        if (isResizingRef.current) return;
        onClose();
      }}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        style={
          isModalMaximized
            ? {
                width: "min(1440px, calc(100vw - 32px))",
                height: "calc(100vh - 32px)",
              }
            : {
                width: `min(${modalDimensions.width}px, calc(100vw - 32px))`,
                height: `min(${modalDimensions.height}px, calc(100vh - 32px))`,
              }
        }
        className={`relative flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-brand-dark shadow-2xl transition-[box-shadow,border-color] duration-150 ${
          isResizing ? "ring-2 ring-brand-orange/40 select-none" : ""
        }`}
      >
        {/* Edge & Corner Resize Handles (active when not maximized) */}
        {!isModalMaximized && (
          <>
            {/* Right edge */}
            <div
              onPointerDown={(e) => startModalResize(e, "e")}
              className="absolute top-0 right-0 h-full w-2.5 cursor-ew-resize hover:bg-brand-orange/20 transition-colors z-20"
              title="Drag to resize horizontally"
            />
            {/* Left edge */}
            <div
              onPointerDown={(e) => startModalResize(e, "w")}
              className="absolute top-0 left-0 h-full w-2.5 cursor-ew-resize hover:bg-brand-orange/20 transition-colors z-20"
              title="Drag to resize horizontally"
            />
            {/* Bottom edge */}
            <div
              onPointerDown={(e) => startModalResize(e, "s")}
              className="absolute bottom-0 left-0 w-full h-2.5 cursor-ns-resize hover:bg-brand-orange/20 transition-colors z-20"
              title="Drag to resize vertically"
            />
            {/* Top edge */}
            <div
              onPointerDown={(e) => startModalResize(e, "n")}
              className="absolute top-0 left-0 w-full h-2 cursor-ns-resize hover:bg-brand-orange/20 transition-colors z-20"
              title="Drag to resize vertically"
            />
            {/* Bottom-right corner handle with 6-dot gripper */}
            <div
              onPointerDown={(e) => startModalResize(e, "se")}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setModalDimensions({
                  width: DEFAULT_WO_MODAL_WIDTH,
                  height: DEFAULT_WO_MODAL_HEIGHT,
                });
                try {
                  localStorage.removeItem(STORAGE_KEY_WO_MODAL);
                } catch {
                  // ignore
                }
              }}
              className="group absolute bottom-1.5 right-1.5 z-30 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5 text-neutral-300 hover:text-brand-orange transition-colors"
              title="Drag to resize (double-click to reset default size)"
              aria-label="Resize modal handle"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                <circle cx="8.5" cy="8.5" r="1" />
                <circle cx="5" cy="8.5" r="1" />
                <circle cx="8.5" cy="5" r="1" />
                <circle cx="1.5" cy="8.5" r="1" />
                <circle cx="5" cy="5" r="1" />
                <circle cx="8.5" cy="1.5" r="1" />
              </svg>
            </div>
            {/* Bottom-left corner handle */}
            <div
              onPointerDown={(e) => startModalResize(e, "sw")}
              className="absolute bottom-0 left-0 z-30 h-5 w-5 cursor-nesw-resize"
            />
            {/* Top-right corner handle */}
            <div
              onPointerDown={(e) => startModalResize(e, "ne")}
              className="absolute top-0 right-0 z-20 h-4 w-4 cursor-nesw-resize"
            />
            {/* Top-left corner handle */}
            <div
              onPointerDown={(e) => startModalResize(e, "nw")}
              className="absolute top-0 left-0 z-20 h-4 w-4 cursor-nwse-resize"
            />
          </>
        )}

        {/* Modal Header */}
        <div
          onDoubleClick={(e) => {
            if ((e.target as HTMLElement).closest("button, a")) return;
            setIsModalMaximized((prev) => !prev);
          }}
          className="flex shrink-0 select-none items-center justify-between border-b border-neutral-200 bg-neutral-50/90 px-6 py-4 cursor-default backdrop-blur-xs"
          title="Double-click header to maximize or restore"
        >
          <div className="min-w-0 pr-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-brand-blue/15 px-2.5 py-0.5 text-xs font-bold text-brand-blue uppercase tracking-wide">
                <Wrench className="h-3 w-3" />
                {orderNumber ? `WO #${orderNumber}` : "Work Order"}
              </span>

              {order?.paid ? (
                <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-emerald-700">
                  Paid
                </span>
              ) : time ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-blue-700">
                  <Clock className="h-3 w-3" />
                  {time}
                </span>
              ) : (
                <span className="rounded-full bg-[#c2410c] px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide text-white shadow-2xs">
                  Unscheduled
                </span>
              )}

              {order?.workOrderType?.label && (
                <span className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-xs font-semibold text-neutral-600">
                  {order.workOrderType.label}
                </span>
              )}
            </div>

            <div className="mt-1 flex items-baseline gap-3">
              <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-brand-dark uppercase truncate">
                {order?.customerName || "Work Order"}
              </h2>
              {order?.tech && (
                <span className="hidden sm:inline-block text-xs font-semibold text-neutral-500">
                  Tech: <span className="font-bold text-neutral-700">{order.tech}</span>
                </span>
              )}
            </div>

            <p className="mt-0.5 text-xs sm:text-sm font-medium text-neutral-500 truncate">
              {[
                order?.customerAddress,
                order?.customerCity,
                order?.customerPhone,
                order?.generatorModel ? `Model: ${order.generatorModel}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>

          {/* Action buttons on header right */}
          <div className="relative z-30 flex shrink-0 items-center gap-1.5">
            {order?._id && (
              <Link
                href={`/dashboard/work-orders/detail?id=${order._id}`}
                target="_blank"
                rel="noreferrer"
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:border-brand-orange hover:text-brand-orange transition-colors shadow-2xs"
                title="Open in new full-page tab"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Full Page</span>
              </Link>
            )}

            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 hover:border-brand-orange hover:text-brand-orange transition-colors shadow-2xs"
              title="Print / Export to PDF"
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Print</span>
            </button>

            <button
              type="button"
              onClick={() => setIsModalMaximized((prev) => !prev)}
              className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
              title={isModalMaximized ? "Restore size" : "Maximize dialog"}
              aria-label={isModalMaximized ? "Restore size" : "Maximize dialog"}
            >
              {isModalMaximized ? (
                <Minimize2 className="h-5 w-5" />
              ) : (
                <Maximize2 className="h-5 w-5" />
              )}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-neutral-400 hover:bg-neutral-100 hover:text-brand-dark transition-colors"
              aria-label="Close work order dialog"
              title="Close (Esc)"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-500 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold">{error}</p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    if (token) {
                      getWorkOrder(token, workOrderId)
                        .then(setOrder)
                        .catch((e: unknown) =>
                          setError(
                            e instanceof ApiError
                              ? e.message
                              : "Failed to reload work order.",
                          ),
                        )
                        .finally(() => setLoading(false));
                    }
                  }}
                  className="mt-2 text-xs font-bold text-red-800 underline hover:no-underline"
                >
                  Retry loading
                </button>
              </div>
            </div>
          )}

          {loading && !order && (
            <div className="flex flex-col items-center justify-center py-20 text-neutral-400 space-y-3">
              <Loader2 className="h-8 w-8 animate-spin text-brand-orange" />
              <p className="text-sm font-medium">Loading work order details…</p>
            </div>
          )}

          {order && (
            <>
              {order.warnings && order.warnings.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 space-y-1">
                  {order.warnings.map((warning) => (
                    <p key={warning} className="font-medium">
                      ⚠️ {warning}
                    </p>
                  ))}
                </div>
              )}

              {order.deletedAt ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                  <p className="font-semibold">
                    This work order is marked as deleted
                    {orderNumber ? ` (${orderNumber})` : ""}.
                  </p>
                  <p className="mt-1 text-xs text-amber-800">
                    Restore it to place it back on active schedules and invoice lists.
                  </p>
                  <button
                    type="button"
                    disabled={restoring || !token}
                    onClick={async () => {
                      if (!token) return;
                      setRestoring(true);
                      setError(null);
                      try {
                        await restoreWorkOrder(token, order._id);
                        const refreshed = await getWorkOrder(token, order._id);
                        setOrder(refreshed);
                        onSaved?.(refreshed);
                      } catch (err) {
                        setError(
                          err instanceof ApiError
                            ? err.message
                            : "Failed to restore work order.",
                        );
                      } finally {
                        setRestoring(false);
                      }
                    }}
                    className="mt-3 inline-flex items-center justify-center rounded-lg bg-brand-orange px-4 py-2 text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 shadow-sm"
                  >
                    {restoring ? "Restoring…" : "Restore work order"}
                  </button>
                </div>
              ) : canWrite && token && user ? (
                <div className="space-y-6">
                  <ServiceTicketForm
                    key={order._id}
                    variant="work-order"
                    initial={ticketFromRecord(order)}
                    recordId={order._id}
                    submitLabel="Save work order"
                    onSubmit={handleSubmit}
                    autoSave={handleAutoSave}
                    invoiceAction={
                      <InvoiceWorkOrderButton
                        token={token}
                        workOrderRef={order._id}
                        sourcePaid={order.paid}
                        onCreated={() => setInvoiceListVersion((v) => v + 1)}
                      />
                    }
                    extraActions={
                      <div className="flex flex-wrap items-center gap-2">
                        {viewInvoiceId && (
                          <Link
                            href={`/dashboard/orders/detail?id=${viewInvoiceId}`}
                            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-brand-orange hover:text-brand-orange transition-colors"
                          >
                            View Invoice
                          </Link>
                        )}
                        {order.customerRef && (
                          <Link
                            href={`/dashboard/customers/detail?id=${order.customerRef}`}
                            className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-700 hover:border-brand-orange hover:text-brand-orange transition-colors"
                          >
                            Customer Profile
                          </Link>
                        )}
                        {confirmingDelete ? (
                          <div className="basis-full pt-2">
                            <SoftDeleteWarning
                              deleting={deleting}
                              onCancel={() => setConfirmingDelete(false)}
                              onConfirm={async () => {
                                if (!token) return;
                                setDeleting(true);
                                setError(null);
                                try {
                                  await deleteWorkOrder(token, order._id);
                                  onClose();
                                } catch (err) {
                                  setDeleting(false);
                                  setError(
                                    err instanceof ApiError
                                      ? err.message
                                      : "Failed to delete work order.",
                                  );
                                }
                              }}
                            />
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmingDelete(true)}
                            className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 transition-colors"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    }
                  />

                  {/* Text / Email Invoice Send Card */}
                  <div className="mt-6 border-t border-neutral-200 pt-6">
                    <WorkOrderInvoiceSend order={order} token={token} />
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <ServiceTicketDocument
                    ticket={ticketViewFromOrder(order)}
                    notesSlot={
                      token && user ? (
                        <WorkOrderNotesPanel
                          token={token}
                          recordId={order._id}
                          userId={user.id}
                          canWrite={false}
                          userRole={user}
                          fallbackContent={order.descPerformed}
                        />
                      ) : undefined
                    }
                  />

                  {token && (
                    <div className="mt-6 border-t border-neutral-200 pt-6">
                      <WorkOrderInvoiceSend order={order} token={token} />
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
