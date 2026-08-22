"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, Pencil } from "lucide-react";
import AuthGuard from "@/components/auth/AuthGuard";
import ServiceTicketDocument from "@/components/billing/ServiceTicketDocument";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import InvoiceBillingPanel from "@/components/billing/InvoiceBillingPanel";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  deleteWorkOrder,
  getWorkOrder,
  updateWorkOrder,
  WorkOrderListItem,
} from "@/lib/api";
import { ticketFromRecord } from "@/lib/service-ticket";

export default function WorkOrderDetailPage() {
  return (
    <AuthGuard>
      <Suspense fallback={<p className="text-sm text-neutral-500">Loading…</p>}>
        <WorkOrderDetailContent />
      </Suspense>
    </AuthGuard>
  );
}

function WorkOrderDetailContent() {
  const router = useRouter();
  const id = useSearchParams().get("id") ?? "";
  const token = useAuthStore((s) => s.token);
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));
  const canDelete = useAuthStore((s) => s.hasPermission("jobs:delete"));
  const [order, setOrder] = useState<WorkOrderListItem | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token || !id) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getWorkOrder(token, id)
      .then(setOrder)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load work order."),
      )
      .finally(() => setLoading(false));
  }, [token, id]);

  if (!id) {
    return (
      <Link href="/dashboard/work-orders" className="text-sm text-neutral-600">
        Back to work orders
      </Link>
    );
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading work order…</p>;
  }
  if (!order) {
    return (
      <div className="space-y-3">
        <Link href="/dashboard/work-orders" className="text-sm text-neutral-600">
          Back to work orders
        </Link>
        <p className="text-sm text-red-700">{error || "Work order not found."}</p>
      </div>
    );
  }

  const number = order.number || (order.legacyId ? String(order.legacyId) : "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link
          href="/dashboard/work-orders"
          className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-brand-dark"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to work orders
        </Link>
        <div className="flex flex-wrap gap-2">
          {order.customerRef ? (
            <Link
              href={`/dashboard/customers/detail?id=${order.customerRef}`}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              Customer
            </Link>
          ) : null}
          <Link
            href="/dashboard/schedule"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            Schedule
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          >
            <Download className="h-4 w-4" />
            Export to PDF
          </button>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setEditing((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-dark px-3 py-2 text-sm font-medium text-white"
            >
              <Pencil className="h-4 w-4" />
              {editing ? "View" : "Edit"}
            </button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
          {error}
        </div>
      ) : null}

      {editing ? (
        <ServiceTicketForm
          variant="work-order"
          initial={ticketFromRecord(order)}
          submitting={submitting}
          submitLabel="Save work order"
          extraActions={
            canDelete ? (
              <button
                type="button"
                onClick={async () => {
                  if (!token || !window.confirm("Delete this work order?")) return;
                  try {
                    await deleteWorkOrder(token, order._id);
                    router.push("/dashboard/work-orders");
                  } catch (err) {
                    setError(
                      err instanceof ApiError
                        ? err.message
                        : "Failed to delete work order.",
                    );
                  }
                }}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700"
              >
                Delete
              </button>
            ) : null
          }
          onSubmit={async (payload) => {
            if (!token) return;
            setSubmitting(true);
            setError(null);
            try {
              const updated = await updateWorkOrder(token, order._id, payload);
              setOrder(updated);
              setEditing(false);
            } catch (err) {
              setError(
                err instanceof ApiError ? err.message : "Failed to save work order.",
              );
            } finally {
              setSubmitting(false);
            }
          }}
        />
      ) : (
        <ServiceTicketDocument
          ticket={{
            variant: "work-order",
            number,
            date: order.date,
            tech: order.tech,
            customerName: order.customerName ?? "",
            customerAddress: order.customerAddress ?? "",
            customerCity: order.customerCity ?? "",
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
            miscExp: order.miscExp ?? 0,
            subtotal: order.subtotal ?? 0,
            shipping: order.shipping ?? 0,
            total: order.total,
            signatureDataUrl: order.signatureDataUrl,
            signedByName: order.signedByName,
          }}
        />
      )}

      {token && !editing ? (
        <div className="print:hidden">
          <InvoiceBillingPanel
            token={token}
            sourceType="work_order"
            workOrderRef={order._id}
            title="Invoice this work order"
          />
        </div>
      ) : null}
    </div>
  );
}
