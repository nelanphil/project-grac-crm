"use client";

import { useEffect, useState } from "react";
import EquipmentWorkOrderTypeChoice from "@/components/billing/EquipmentWorkOrderTypeChoice";
import ServiceTicketDocument, {
  type ServiceTicketView,
} from "@/components/billing/ServiceTicketDocument";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import TicketLineItemsEditor from "@/components/billing/TicketLineItemsEditor";
import WorkOrderNotesPanel from "@/components/billing/WorkOrderNotesPanel";
import {
  ApiError,
  getWorkOrderTypes,
  updateWorkOrder,
  type WorkOrderListItem,
  type WorkOrderTypeItem,
} from "@/lib/api";
import { isDispatcherRole, type RoleLike } from "@/lib/dashboard-role";
import {
  hasEquipmentProductLines,
  nextTicketWorkOrderType,
  ticketFromRecord,
  ticketToPayload,
  workOrderTypeSaveIssue,
  type TicketPartRow,
} from "@/lib/service-ticket";

type PanelUser = RoleLike & { id: string };

async function saveWorkOrder(
  token: string,
  order: WorkOrderListItem,
  payload: ReturnType<typeof ticketToPayload>,
  user: PanelUser | null,
): Promise<WorkOrderListItem> {
  const { assignedUserRef, ...rest } = payload;
  const nextAssigned = assignedUserRef ?? null;
  const prevAssigned = order.assignedUserRef ?? null;
  return updateWorkOrder(token, order._id, {
    ...rest,
    ...(user && isDispatcherRole(user) && nextAssigned !== prevAssigned
      ? { assignedUserRef: nextAssigned }
      : {}),
  });
}

function ticketView(order: WorkOrderListItem): ServiceTicketView {
  const number = order.number || (order.legacyId ? String(order.legacyId) : "");
  return {
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
    totalAgreements: order.totalAgreements ?? 0,
    miscExp: order.miscExp ?? 0,
    subtotal: order.subtotal ?? 0,
    shipping: order.shipping ?? 0,
    total: order.total,
    signatureDataUrl: order.signatureDataUrl,
    signedByName: order.signedByName,
    contractDiscount: order.contractDiscount,
  };
}

function PanelStatus({
  loading,
  error,
}: {
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <p className="text-sm text-[var(--staff-muted)]">Loading work order…</p>;
  }
  if (error) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {error}
      </p>
    );
  }
  return null;
}

export function DesktopWorkOrderPanel({
  order,
  loading,
  error,
  token,
  user,
  canWrite,
  onClose,
  onSaved,
}: {
  order: WorkOrderListItem | null;
  loading: boolean;
  error: string | null;
  token: string | null;
  user: PanelUser | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (order: WorkOrderListItem) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--staff-ink)]">Work order</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--staff-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
        >
          Close
        </button>
      </div>
      <PanelStatus loading={loading} error={error} />
      {saveError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError}
        </p>
      ) : null}
      {order && token && user ? (
        canWrite ? (
          <ServiceTicketForm
            key={order._id}
            variant="work-order"
            initial={ticketFromRecord(order)}
            recordId={order._id}
            submitting={submitting}
            submitLabel="Save work order"
            onSubmit={async (payload) => {
              setSubmitting(true);
              setSaveError(null);
              try {
                const updated = await saveWorkOrder(token, order, payload, user);
                onSaved(updated);
              } catch (err) {
                setSaveError(
                  err instanceof ApiError ? err.message : "Failed to save work order.",
                );
              } finally {
                setSubmitting(false);
              }
            }}
          />
        ) : (
          <ServiceTicketDocument
            ticket={ticketView(order)}
            notesSlot={
              <WorkOrderNotesPanel
                token={token}
                recordId={order._id}
                userId={user.id}
                canWrite={false}
                userRole={user}
                fallbackContent={order.descPerformed}
              />
            }
          />
        )
      ) : null}
    </section>
  );
}

function ProductLines({ order }: { order: WorkOrderListItem }) {
  const lines = (order.parts ?? []).filter(
    (part) => part.description?.trim() || part.partNumber?.trim(),
  );
  if (lines.length === 0) {
    return <p className="text-sm text-[var(--staff-muted)]">No products on this work order.</p>;
  }
  return (
    <ul className="space-y-2">
      {lines.map((part, index) => (
        <li key={`${part.partNumber}-${index}`} className="min-w-0 text-sm">
          <p className="break-words font-medium text-[var(--staff-ink)]">
            {part.description?.trim() || part.partNumber}
          </p>
          <p className="text-[var(--staff-muted)]">
            {part.partNumber ? `${part.partNumber} · ` : ""}
            Qty {part.quantity}
          </p>
        </li>
      ))}
    </ul>
  );
}

export function MobileWorkOrderPanel({
  order,
  loading,
  error,
  token,
  user,
  canWrite,
  onClose,
  onSaved,
}: {
  order: WorkOrderListItem | null;
  loading: boolean;
  error: string | null;
  token: string | null;
  user: PanelUser | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved: (order: WorkOrderListItem) => void;
}) {
  const [parts, setParts] = useState<TicketPartRow[]>([]);
  const [workOrderTypeRef, setWorkOrderTypeRef] = useState<string | null>(null);
  const [workOrderTypeLabel, setWorkOrderTypeLabel] = useState("");
  const [trackedEquipment, setTrackedEquipment] = useState(false);
  const [workOrderTypes, setWorkOrderTypes] = useState<WorkOrderTypeItem[]>([]);
  const [workOrderTypesLoaded, setWorkOrderTypesLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!order) return;
    const form = ticketFromRecord(order);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setParts(form.parts);
    setWorkOrderTypeRef(form.workOrderTypeRef);
    setWorkOrderTypeLabel(form.workOrderTypeLabel);
    setTrackedEquipment(form.trackedEquipment);
    setSaveError(null);
  }, [order]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getWorkOrderTypes(token)
      .then(({ types }) => {
        if (!cancelled) setWorkOrderTypes(types);
      })
      .catch(() => {
        if (!cancelled) setWorkOrderTypes([]);
      })
      .finally(() => {
        if (!cancelled) setWorkOrderTypesLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const hasEquipmentLines = hasEquipmentProductLines(parts);
  if (workOrderTypes.length > 0) {
    const nextType = nextTicketWorkOrderType({
      variant: "work-order",
      hadEquipment: trackedEquipment,
      hasEquipment: hasEquipmentLines,
      workOrderTypeRef,
      workOrderTypeLabel,
      types: workOrderTypes,
    });
    if (trackedEquipment !== hasEquipmentLines) {
      setTrackedEquipment(hasEquipmentLines);
    }
    if (
      nextType.workOrderTypeRef !== workOrderTypeRef ||
      nextType.workOrderTypeLabel !== workOrderTypeLabel
    ) {
      setWorkOrderTypeRef(nextType.workOrderTypeRef);
      setWorkOrderTypeLabel(nextType.workOrderTypeLabel);
    }
  }
  const typeSaveIssue = workOrderTypeSaveIssue({
    variant: "work-order",
    parts,
    workOrderTypeRef,
    types: workOrderTypes,
    typesLoaded: workOrderTypesLoaded,
  });

  return (
    <section className="min-w-0 space-y-4 rounded-xl border border-[var(--staff-border)] bg-[var(--staff-surface)] p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-[var(--staff-ink)]">Work order</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-[var(--staff-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--staff-ink)] hover:bg-[var(--staff-cream)]"
        >
          Close
        </button>
      </div>
      <PanelStatus loading={loading} error={error} />
      {order && token && user ? (
        <>
          <div className="min-w-0 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
              Products
            </h3>
            {canWrite ? (
              <>
                <TicketLineItemsEditor parts={parts} onChange={setParts} />
                {hasEquipmentLines ? (
                  <EquipmentWorkOrderTypeChoice
                    types={workOrderTypes}
                    value={workOrderTypeRef}
                    message={typeSaveIssue.message}
                    onChange={(type) => {
                      setWorkOrderTypeRef(type._id);
                      setWorkOrderTypeLabel(type.label);
                    }}
                  />
                ) : typeSaveIssue.message ? (
                  <p className="text-sm text-red-700">{typeSaveIssue.message}</p>
                ) : null}
                {saveError ? (
                  <p className="text-sm text-red-700">{saveError}</p>
                ) : null}
                <button
                  type="button"
                  disabled={saving || typeSaveIssue.blocked}
                  onClick={() => {
                    if (typeSaveIssue.blocked) return;
                    setSaving(true);
                    setSaveError(null);
                    const form = {
                      ...ticketFromRecord(order),
                      parts,
                      workOrderTypeRef,
                      workOrderTypeLabel,
                      trackedEquipment: hasEquipmentLines,
                    };
                    void saveWorkOrder(token, order, ticketToPayload(form), user)
                      .then(onSaved)
                      .catch((err: unknown) => {
                        setSaveError(
                          err instanceof ApiError
                            ? err.message
                            : "Failed to save products.",
                        );
                      })
                      .finally(() => setSaving(false));
                  }}
                  className="rounded-md bg-brand-dark px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-60"
                >
                  {saving ? "Saving…" : "Save products"}
                </button>
              </>
            ) : (
              <ProductLines order={order} />
            )}
          </div>
          <WorkOrderNotesPanel
            token={token}
            recordId={order._id}
            userId={user.id}
            canWrite={canWrite}
            userRole={user}
            fallbackContent={order.descPerformed}
          />
        </>
      ) : null}
    </section>
  );
}
