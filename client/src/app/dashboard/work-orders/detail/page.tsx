"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Download } from "lucide-react";
import SoftDeleteWarning from "@/components/work-orders/SoftDeleteWarning";
import AuthGuard from "@/components/auth/AuthGuard";
import DashboardBackLink, {
  dashboardBackLinkMutedClass,
} from "@/components/dashboard/DashboardBackLink";
import ServiceTicketDocument from "@/components/billing/ServiceTicketDocument";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import InvoiceWorkOrderButton from "@/components/billing/InvoiceWorkOrderButton";
import WorkOrderNotesPanel from "@/components/billing/WorkOrderNotesPanel";
import { useAuthStore } from "@/store/useAuthStore";
import {
  ApiError,
  deleteWorkOrder,
  restoreWorkOrder,
  getInvoices,
  getWorkOrder,
  InvoiceItem,
  updateWorkOrder,
  WorkOrderListItem,
} from "@/lib/api";
import { isDispatcherRole } from "@/lib/schedule";
import { ticketFromRecord, type ticketToPayload } from "@/lib/service-ticket";

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
  const user = useAuthStore((s) => s.user);
  const canWrite = useAuthStore((s) => s.hasPermission("jobs:write"));
  const [order, setOrder] = useState<WorkOrderListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [viewInvoiceId, setViewInvoiceId] = useState<string | null>(null);
  const [invoiceListVersion, setInvoiceListVersion] = useState(0);

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

  useEffect(() => {
    if (!token || !id) return;
    let cancelled = false;
    getInvoices(token, { workOrderRef: id })
      .then(({ invoices }) => {
        if (!cancelled) setViewInvoiceId(pickRelatedWorkOrderInvoice(invoices));
      })
      .catch(() => {
        if (!cancelled) setViewInvoiceId(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, id, invoiceListVersion]);

  const backLink = (
    <DashboardBackLink
      fallbackHref="/dashboard/work-orders"
      fallbackLabel="Back to work orders"
      className={dashboardBackLinkMutedClass}
    />
  );

  if (!id) {
    return backLink;
  }

  if (loading) {
    return <p className="text-sm text-neutral-500">Loading work order…</p>;
  }
  if (!order) {
    return (
      <div className="space-y-3">
        {backLink}
        <p className="text-sm text-red-700">{error || "Work order not found."}</p>
      </div>
    );
  }

  const number = order.number || (order.legacyId ? String(order.legacyId) : "");
  const ticket = {
    variant: "work-order" as const,
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

  const notesPanel =
    token && user ? (
      <WorkOrderNotesPanel
        token={token}
        recordId={order._id}
        userId={user.id}
        canWrite={canWrite}
        userRole={user}
        fallbackContent={order.descPerformed}
      />
    ) : null;

  const printNotes =
    token && user ? (
      <WorkOrderNotesPanel
        token={token}
        recordId={order._id}
        userId={user.id}
        canWrite={false}
        userRole={user}
        fallbackContent={order.descPerformed}
      />
    ) : null;

  async function saveOrder(
    payload: ReturnType<typeof ticketToPayload> & { scheduleInsertIndex?: number },
  ) {
    if (!token || !order) throw new Error("Work order is not loaded.");
    const { assignedUserRef, scheduleInsertIndex: _insert, ...rest } = payload;
    const nextAssigned = assignedUserRef ?? null;
    const prevAssigned = order.assignedUserRef ?? null;
    return updateWorkOrder(token, order._id, {
      ...rest,
      ...(isDispatcherRole(user) && nextAssigned !== prevAssigned
        ? { assignedUserRef: nextAssigned }
        : {}),
    });
  }

  const invoiceAction =
    token ? (
      <InvoiceWorkOrderButton
        token={token}
        workOrderRef={order._id}
        sourcePaid={order.paid}
        onCreated={() => setInvoiceListVersion((version) => version + 1)}
      />
    ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        {backLink}
        <div className="flex flex-wrap gap-2">
          {viewInvoiceId ? (
            <Link
              href={`/dashboard/orders/detail?id=${viewInvoiceId}`}
              className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            >
              View invoice
            </Link>
          ) : null}
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
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 print:hidden">
          {error}
        </div>
      ) : null}

      {order.warnings && order.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 print:hidden">
          {order.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {order.deletedAt ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900 print:hidden">
          <p>
            This work order is deleted
            {number ? ` (${number})` : ""}. Restore it to put it back on
            schedules and lists.
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
                router.push("/dashboard/work-orders");
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
            className="mt-3 inline-flex items-center justify-center rounded-md bg-brand-orange px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60"
          >
            {restoring ? "Restoring…" : "Restore"}
          </button>
        </div>
      ) : canWrite ? (
        <>
          <ServiceTicketForm
            variant="work-order"
            initial={ticketFromRecord(order)}
            recordId={order._id}
            submitting={submitting}
            submitLabel="Save work order"
            invoiceAction={invoiceAction}
            extraActions={
              confirmingDelete ? (
                <div className="basis-full">
                  <SoftDeleteWarning
                    deleting={deleting}
                    onCancel={() => setConfirmingDelete(false)}
                    onConfirm={async () => {
                      if (!token) return;
                      setDeleting(true);
                      setError(null);
                      try {
                        await deleteWorkOrder(token, order._id);
                        router.push("/dashboard/work-orders");
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
                  className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700"
                >
                  Delete
                </button>
              )
            }
            autoSave={async (payload) => {
              if (!token) throw new Error("You are signed out.");
              const updated = await saveOrder(payload);
              setError(null);
              setOrder(updated);
              if (updated.total !== order.total || updated.paid !== order.paid) {
                setInvoiceListVersion((version) => version + 1);
              }
              return ticketFromRecord(updated);
            }}
            onSubmit={async (payload) => {
              if (!token) return;
              setSubmitting(true);
              setError(null);
              try {
                setOrder(await saveOrder(payload));
              } catch (err) {
                setError(
                  err instanceof ApiError ? err.message : "Failed to save work order.",
                );
              } finally {
                setSubmitting(false);
              }
            }}
          />
          <div className="hidden print:block">
            <ServiceTicketDocument ticket={ticket} notesSlot={printNotes} />
          </div>
        </>
      ) : (
        <ServiceTicketDocument
          ticket={ticket}
          invoiceAction={invoiceAction}
          notesSlot={notesPanel}
        />
      )}
    </div>
  );
}

function pickRelatedWorkOrderInvoice(invoices: InvoiceItem[]): string | null {
  const viewable = invoices.filter((invoice) => invoice.status !== "void");
  const open = viewable.find((invoice) => invoice.status === "open");
  return (open ?? viewable[0])?._id ?? null;
}
