"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import AutosaveStatus from "@/components/billing/AutosaveStatus";
import EquipmentWorkOrderTypeChoice from "@/components/billing/EquipmentWorkOrderTypeChoice";
import {
  ExerciseDaySelect,
  ExerciseTimeInput,
} from "@/components/billing/ExerciseScheduleFields";
import ServiceTicketDocument, {
  type ServiceTicketView,
} from "@/components/billing/ServiceTicketDocument";
import ServiceTicketForm from "@/components/billing/ServiceTicketForm";
import TicketLineItemsEditor from "@/components/billing/TicketLineItemsEditor";
import WorkOrderNotesPanel from "@/components/billing/WorkOrderNotesPanel";
import WorkOrderInvoiceSend from "@/components/dashboard/staff/WorkOrderInvoiceSend";
import {
  getWorkOrderTypes,
  updateWorkOrder,
  type WorkOrderListItem,
  type WorkOrderTypeItem,
} from "@/lib/api";
import { isDispatcherRole, type RoleLike } from "@/lib/dashboard-role";
import {
  applyEnrolledRefs,
  emptyTicketForm,
  enrolledRefsFromSave,
  hasEquipmentProductLines,
  nextTicketWorkOrderType,
  ticketFromRecord,
  ticketToPayload,
  workOrderTypeSaveIssue,
  type TicketFormState,
  type TicketPartRow,
} from "@/lib/service-ticket";
import {
  exerciseDayLabel,
  exerciseTimeLabel,
} from "@/lib/exercise-schedule";
import { useWorkOrderAutosave } from "@/lib/useWorkOrderAutosave";

type PanelUser = RoleLike & { id: string };

type ProductsDraft = Pick<
  TicketFormState,
  | "parts"
  | "workOrderTypeRef"
  | "workOrderTypeLabel"
  | "trackedEquipment"
  | "serialNumber"
  | "generatorModel"
  | "runHours"
  | "exerciseDay"
  | "exerciseTime"
>;

function serializeProductsDraft(draft: ProductsDraft): string {
  const { parts, serialNumber, generatorModel, runHours, exerciseDay, exerciseTime } =
    ticketToPayload({
      ...emptyTicketForm(),
      parts: draft.parts,
      serialNumber: draft.serialNumber,
      generatorModel: draft.generatorModel,
      runHours: draft.runHours,
      exerciseDay: draft.exerciseDay,
      exerciseTime: draft.exerciseTime,
    });
  return JSON.stringify({
    parts,
    workOrderTypeRef: draft.workOrderTypeRef,
    serialNumber,
    generatorModel,
    runHours,
    exerciseDay,
    exerciseTime,
  });
}

const equipmentInputClass =
  "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm text-brand-dark focus:border-brand-blue focus:outline-none focus:ring-1 focus:ring-brand-blue";

function EquipmentField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function displayValue(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const text = String(value).trim();
  return text || "—";
}

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
      {order && token && user ? (
        canWrite ? (
          <ServiceTicketForm
            key={order._id}
            variant="work-order"
            initial={ticketFromRecord(order)}
            recordId={order._id}
            submitLabel="Save work order"
            onSubmit={() => {}}
            autoSave={async (payload) => {
              const updated = await saveWorkOrder(token, order, payload, user);
              onSaved(updated);
              return ticketFromRecord(updated);
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
      {order && token ? <WorkOrderInvoiceSend order={order} token={token} /> : null}
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
  const [serialNumber, setSerialNumber] = useState("");
  const [generatorModel, setGeneratorModel] = useState("");
  const [runHours, setRunHours] = useState("");
  const [exerciseDay, setExerciseDay] = useState("");
  const [exerciseTime, setExerciseTime] = useState("");
  const [workOrderTypes, setWorkOrderTypes] = useState<WorkOrderTypeItem[]>([]);
  const [workOrderTypesLoaded, setWorkOrderTypesLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Saves hand back a new `order`; only a different work order resets the draft.
  if (order && order._id !== loadedFor) {
    const form = ticketFromRecord(order);
    setLoadedFor(order._id);
    setParts(form.parts);
    setWorkOrderTypeRef(form.workOrderTypeRef);
    setWorkOrderTypeLabel(form.workOrderTypeLabel);
    setTrackedEquipment(form.trackedEquipment);
    setSerialNumber(form.serialNumber);
    setGeneratorModel(form.generatorModel);
    setRunHours(form.runHours);
    setExerciseDay(form.exerciseDay);
    setExerciseTime(form.exerciseTime);
  }

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

  const draft = useMemo<ProductsDraft>(
    () => ({
      parts,
      workOrderTypeRef,
      workOrderTypeLabel,
      trackedEquipment: hasEquipmentLines,
      serialNumber,
      generatorModel,
      runHours,
      exerciseDay,
      exerciseTime,
    }),
    [
      parts,
      workOrderTypeRef,
      workOrderTypeLabel,
      hasEquipmentLines,
      serialNumber,
      generatorModel,
      runHours,
      exerciseDay,
      exerciseTime,
    ],
  );
  const saveProducts = useCallback(
    async (sent: ProductsDraft) => {
      if (!order || !token) throw new Error("Work order is not loaded.");
      const payload = ticketToPayload({ ...ticketFromRecord(order), ...sent });
      const updated = await saveWorkOrder(token, order, payload, user);
      onSaved(updated);
      const refs = enrolledRefsFromSave(
        sent.parts,
        ticketFromRecord(updated).parts,
      );
      setParts((current) => applyEnrolledRefs(current, refs));
    },
    [order, token, user, onSaved],
  );
  const autosave = useWorkOrderAutosave({
    value: draft,
    serialize: serializeProductsDraft,
    save: saveProducts,
    blocked: !canWrite || !order || typeSaveIssue.blocked,
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
          {canWrite ? (
            <div
              className="min-w-0 space-y-4"
              onChangeCapture={autosave.arm}
              onClickCapture={autosave.arm}
              onBlurCapture={autosave.flush}
            >
              <div className="min-w-0 space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                  Equipment
                </h3>
                <EquipmentField label="Model">
                  <input
                    value={generatorModel}
                    onChange={(event) => setGeneratorModel(event.target.value)}
                    className={equipmentInputClass}
                  />
                </EquipmentField>
                <EquipmentField label="Serial number">
                  <input
                    value={serialNumber}
                    onChange={(event) => setSerialNumber(event.target.value)}
                    className={equipmentInputClass}
                  />
                </EquipmentField>
                <EquipmentField label="Run hours">
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={runHours}
                    onChange={(event) => setRunHours(event.target.value)}
                    className={equipmentInputClass}
                  />
                </EquipmentField>
                <EquipmentField label="Exercise Day">
                  <ExerciseDaySelect
                    value={exerciseDay}
                    onChange={setExerciseDay}
                    className={equipmentInputClass}
                  />
                </EquipmentField>
                <EquipmentField label="Time Set">
                  <ExerciseTimeInput
                    value={exerciseTime}
                    onChange={setExerciseTime}
                    className={equipmentInputClass}
                  />
                </EquipmentField>
              </div>
              <div className="min-w-0 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                  Products
                </h3>
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
              </div>
              <AutosaveStatus
                status={autosave.status}
                error={autosave.error}
                onRetry={autosave.retry}
                className="text-xs"
              />
            </div>
          ) : (
            <>
              <div className="min-w-0 space-y-2 text-sm">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                  Equipment
                </h3>
                <p className="break-words text-[var(--staff-ink)]">
                  <span className="text-[var(--staff-muted)]">Model </span>
                  {displayValue(order.generatorModel)}
                </p>
                <p className="break-words text-[var(--staff-ink)]">
                  <span className="text-[var(--staff-muted)]">Serial number </span>
                  {displayValue(order.serialNumber)}
                </p>
                <p className="break-words text-[var(--staff-ink)]">
                  <span className="text-[var(--staff-muted)]">Run hours </span>
                  {displayValue(order.runHours)}
                </p>
                <p className="break-words text-[var(--staff-ink)]">
                  <span className="text-[var(--staff-muted)]">Exercise Day </span>
                  {displayValue(exerciseDayLabel(order.exerciseDay))}
                </p>
                <p className="break-words text-[var(--staff-ink)]">
                  <span className="text-[var(--staff-muted)]">Time Set </span>
                  {displayValue(exerciseTimeLabel(order.exerciseTime))}
                </p>
              </div>
              <div className="min-w-0 space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--staff-muted)]">
                  Products
                </h3>
                <ProductLines order={order} />
              </div>
            </>
          )}
          <WorkOrderNotesPanel
            token={token}
            recordId={order._id}
            userId={user.id}
            canWrite={canWrite}
            userRole={user}
            fallbackContent={order.descPerformed}
          />
          <WorkOrderInvoiceSend order={order} token={token} />
        </>
      ) : null}
    </section>
  );
}
