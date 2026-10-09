import { toUsStateCode } from "./constants";
import {
  DEFAULT_PRODUCT_DISCOUNTS,
  discountedLaborTotal,
  discountedUnitPrice,
  type ProductDiscounts,
  type TicketContractDiscount,
} from "./productDiscounts";

export const LABOR_INCLUDED_MINUTES = 30;
export const LABOR_BLOCK_MINUTES = 30;
export const LABOR_BLOCK_RATE = 75;

export type TicketVariant = "work-order" | "estimate";
export type TicketLineType = "product" | "note" | "agreement";
export type TicketProductKind = "part" | "labor" | "equipment";

export const SERVICE_WORK_ORDER_TYPE_SLUG = "service";
export const NEW_INSTALL_WORK_ORDER_TYPE_SLUG = "new-install";
export const SWAP_WORK_ORDER_TYPE_SLUG = "swap";

export type WorkOrderTypeChoice = {
  _id: string;
  label: string;
  slug: string;
};

export interface TicketPartRow {
  id: string;
  lineType: TicketLineType;
  kind: TicketProductKind;
  productRef: string;
  contractTemplateRef: string;
  enrolledContractRef: string;
  partNumber: string;
  description: string;
  quantity: string;
  listPrice: string;
  unitPrice: string;
  priceOverridden: boolean;
}

export interface TicketFormState {
  number: string;
  date: string;
  startTime: string;
  endTime: string;
  tech: string;
  assignedUserRef: string | null;
  workOrderTypeRef: string | null;
  workOrderTypeLabel: string;
  /** True once this form has shown an equipment line, so removing the last one can reset the type. */
  trackedEquipment: boolean;
  customerRef: string;
  customerId: number | null;
  addressRef: string;
  equipmentRef: string;
  customerName: string;
  customerAddress: string;
  customerCity: string;
  customerState: string;
  customerZip: string;
  customerPhone: string;
  customerEmail: string;
  workPhone: string;
  serialNumber: string;
  generatorModel: string;
  exerciseDay: string;
  exerciseTime: string;
  paid: boolean;
  runHours: string;
  laborHours: string;
  laborOverridden: boolean;
  totalLabor: string;
  descPerform: string;
  descPerformed: string;
  parts: TicketPartRow[];
  miscExp: string;
  shipping: string;
  signatureDataUrl: string;
  signedByName: string;
  completed: boolean;
  status: "draft" | "sent" | "accepted" | "declined" | "converted";
  contractRef: string;
  contractDiscount: TicketContractDiscount | null;
}

export function newRowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function emptyPartRow(): TicketPartRow {
  return {
    id: newRowId(),
    lineType: "product",
    kind: "part",
    productRef: "",
    contractTemplateRef: "",
    enrolledContractRef: "",
    partNumber: "",
    description: "",
    quantity: "",
    listPrice: "",
    unitPrice: "",
    priceOverridden: false,
  };
}

export function emptyAgreementRow(): TicketPartRow {
  return {
    ...emptyPartRow(),
    lineType: "agreement",
  };
}

export function isBlankProductRow(row: TicketPartRow): boolean {
  return (
    row.lineType === "product" &&
    !row.productRef.trim() &&
    !row.partNumber.trim() &&
    !row.description.trim()
  );
}

export function withTrailingEmptyProduct(parts: TicketPartRow[]): TicketPartRow[] {
  const last = [...parts].reverse().find((row) => row.lineType === "product");
  if (last && isBlankProductRow(last)) return parts;
  return [...parts, emptyPartRow()];
}

export function insertEmptyProductBelow(
  parts: TicketPartRow[],
  rowId: string,
): { parts: TicketPartRow[]; emptyId: string } {
  const index = parts.findIndex((row) => row.id === rowId);
  const next = index >= 0 ? parts[index + 1] : undefined;
  if (next && isBlankProductRow(next)) {
    return { parts, emptyId: next.id };
  }
  const empty = emptyPartRow();
  if (index < 0) {
    return { parts: [...parts, empty], emptyId: empty.id };
  }
  return {
    parts: [...parts.slice(0, index + 1), empty, ...parts.slice(index + 1)],
    emptyId: empty.id,
  };
}

export function emptyNoteRow(): TicketPartRow {
  return {
    id: newRowId(),
    lineType: "note",
    kind: "part",
    productRef: "",
    contractTemplateRef: "",
    enrolledContractRef: "",
    partNumber: "",
    description: "",
    quantity: "",
    listPrice: "",
    unitPrice: "",
    priceOverridden: false,
  };
}

export function emptyTicketForm(): TicketFormState {
  return {
    number: "",
    date: new Date().toISOString().slice(0, 10),
    startTime: "",
    endTime: "",
    tech: "",
    assignedUserRef: null,
    workOrderTypeRef: null,
    workOrderTypeLabel: "",
    trackedEquipment: false,
    customerRef: "",
    customerId: null,
    addressRef: "",
    equipmentRef: "",
    customerName: "",
    customerAddress: "",
    customerCity: "",
    customerState: "FL",
    customerZip: "",
    customerPhone: "",
    customerEmail: "",
    workPhone: "",
    serialNumber: "",
    generatorModel: "",
    exerciseDay: "",
    exerciseTime: "",
    paid: false,
    runHours: "",
    laborHours: "",
    laborOverridden: false,
    totalLabor: "",
    descPerform: "",
    descPerformed: "",
    parts: withTrailingEmptyProduct([]),
    miscExp: "",
    shipping: "",
    signatureDataUrl: "",
    signedByName: "",
    completed: false,
    status: "draft",
    contractRef: "",
    contractDiscount: null,
  };
}

export function parseMoney(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function defaultLaborTotal(laborHours: number): number {
  const minutes = Math.max(0, laborHours) * 60;
  const extra = Math.max(0, minutes - LABOR_INCLUDED_MINUTES);
  if (extra <= 0) return 0;
  return Math.ceil(extra / LABOR_BLOCK_MINUTES) * LABOR_BLOCK_RATE;
}

export function applyDiscountsToParts(
  parts: TicketPartRow[],
  discounts: ProductDiscounts | null | undefined,
): TicketPartRow[] {
  const rules = discounts ?? DEFAULT_PRODUCT_DISCOUNTS;
  return parts.map((row) => {
    if (row.lineType !== "product" || row.priceOverridden) return row;
    const list = parseMoney(row.listPrice) || parseMoney(row.unitPrice);
    if (!row.listPrice && !row.unitPrice) return row;
    return {
      ...row,
      unitPrice: String(
        discountedUnitPrice(list, row.kind === "labor" ? "labor" : "part", rules),
      ),
    };
  });
}

export function partAmount(row: TicketPartRow): number {
  if (row.lineType === "note") return 0;
  return Math.round(parseMoney(row.quantity) * parseMoney(row.unitPrice) * 100) / 100;
}

export function hasLaborProductLines(parts: TicketPartRow[]): boolean {
  return parts.some((row) => row.lineType === "product" && row.kind === "labor");
}

export function hasEquipmentProductLines(
  parts: Array<{ lineType?: string; kind?: string }>,
): boolean {
  return parts.some(
    (row) => (row.lineType ?? "product") === "product" && row.kind === "equipment",
  );
}

export function ticketProductKindPrefix(kind: string | undefined): string {
  if (kind === "labor") return "Labor · ";
  if (kind === "equipment") return "Equipment · ";
  return "";
}

export function nextTicketWorkOrderType(opts: {
  variant: TicketVariant;
  hadEquipment: boolean;
  hasEquipment: boolean;
  workOrderTypeRef: string | null;
  workOrderTypeLabel: string;
  types: WorkOrderTypeChoice[];
}): { workOrderTypeRef: string | null; workOrderTypeLabel: string } {
  const service = opts.types.find((type) => type.slug === SERVICE_WORK_ORDER_TYPE_SLUG);
  const install = opts.types.find(
    (type) => type.slug === NEW_INSTALL_WORK_ORDER_TYPE_SLUG,
  );
  const swap = opts.types.find((type) => type.slug === SWAP_WORK_ORDER_TYPE_SLUG);
  const allowed = new Set(
    [install?._id, swap?._id].filter((id): id is string => Boolean(id)),
  );

  if (opts.hasEquipment) {
    if (opts.workOrderTypeRef && allowed.has(opts.workOrderTypeRef)) {
      const selected =
        opts.workOrderTypeRef === install?._id ? install : swap;
      return {
        workOrderTypeRef: opts.workOrderTypeRef,
        workOrderTypeLabel: selected?.label || opts.workOrderTypeLabel,
      };
    }
    return { workOrderTypeRef: null, workOrderTypeLabel: "" };
  }

  if (opts.variant === "estimate" || opts.hadEquipment) {
    if (opts.variant === "estimate") {
      return { workOrderTypeRef: null, workOrderTypeLabel: "" };
    }
    if (service) {
      return { workOrderTypeRef: service._id, workOrderTypeLabel: service.label };
    }
    return { workOrderTypeRef: null, workOrderTypeLabel: "" };
  }

  if (!opts.workOrderTypeRef && service) {
    return { workOrderTypeRef: service._id, workOrderTypeLabel: service.label };
  }

  return {
    workOrderTypeRef: opts.workOrderTypeRef,
    workOrderTypeLabel: opts.workOrderTypeLabel,
  };
}

export function workOrderTypeSaveIssue(opts: {
  variant: TicketVariant;
  parts: Array<{ lineType?: string; kind?: string }>;
  workOrderTypeRef: string | null;
  types: WorkOrderTypeChoice[];
  typesLoaded: boolean;
}): { blocked: boolean; message: string | null } {
  const hasEquipment = hasEquipmentProductLines(opts.parts);
  if (!opts.typesLoaded) {
    const waiting =
      hasEquipment || (opts.variant === "work-order" && !opts.workOrderTypeRef);
    return { blocked: waiting, message: null };
  }

  if (hasEquipment) {
    const install = opts.types.find(
      (type) => type.slug === NEW_INSTALL_WORK_ORDER_TYPE_SLUG,
    );
    const swap = opts.types.find((type) => type.slug === SWAP_WORK_ORDER_TYPE_SLUG);
    if (!install || !swap) {
      return {
        blocked: true,
        message: "Add New Install and Swap work order types in Control Panel.",
      };
    }
    const chosen =
      opts.workOrderTypeRef === install._id || opts.workOrderTypeRef === swap._id;
    return { blocked: !chosen, message: null };
  }

  if (opts.variant === "work-order" && !opts.workOrderTypeRef) {
    const service = opts.types.some(
      (type) => type.slug === SERVICE_WORK_ORDER_TYPE_SLUG,
    );
    return {
      blocked: true,
      message: service ? null : "Add a Service work order type in Control Panel.",
    };
  }

  return { blocked: false, message: null };
}

export function ticketTotals(form: TicketFormState) {
  const totalParts = form.parts.reduce((sum, row) => {
    if (row.lineType !== "product" || row.kind === "labor") return sum;
    return sum + partAmount(row);
  }, 0);
  const totalAgreements = form.parts.reduce((sum, row) => {
    if (row.lineType !== "agreement") return sum;
    return sum + partAmount(row);
  }, 0);
  const lineLabor = form.parts.reduce((sum, row) => {
    if (row.lineType !== "product" || row.kind !== "labor") return sum;
    return sum + partAmount(row);
  }, 0);
  const laborHours = parseMoney(form.laborHours);
  const totalLabor = hasLaborProductLines(form.parts)
    ? lineLabor
    : form.laborOverridden
      ? parseMoney(form.totalLabor)
      : discountedLaborTotal(
          defaultLaborTotal(laborHours),
          form.contractDiscount ?? DEFAULT_PRODUCT_DISCOUNTS,
        );
  const miscExp = parseMoney(form.miscExp);
  const shipping = parseMoney(form.shipping);
  const subtotal =
    Math.round((totalParts + totalLabor + totalAgreements + miscExp) * 100) / 100;
  const total = Math.round((subtotal + shipping) * 100) / 100;
  return {
    totalParts,
    totalLabor,
    totalAgreements,
    miscExp,
    shipping,
    subtotal,
    total,
    laborHours,
  };
}

/** Rows that `ticketToPayload` sends; blank rows stay client-only. */
export function isPersistedTicketRow(row: TicketPartRow): boolean {
  if (row.lineType === "note") return Boolean(row.description.trim());
  if (row.lineType === "agreement") {
    return Boolean(row.contractTemplateRef.trim() || row.description.trim());
  }
  return Boolean(row.partNumber.trim() || row.description.trim());
}

/** Agreement contract refs the server enrolled for the rows in `sent`, keyed by row id. */
export function enrolledRefsFromSave(
  sent: TicketPartRow[],
  saved: TicketPartRow[],
): Map<string, string> {
  const sentRows = sent.filter(isPersistedTicketRow);
  const savedRows = saved.filter(isPersistedTicketRow);
  const refs = new Map<string, string>();
  sentRows.forEach((row, index) => {
    const match = savedRows[index];
    if (
      row.lineType === "agreement" &&
      !row.enrolledContractRef &&
      match?.lineType === "agreement" &&
      match.contractTemplateRef === row.contractTemplateRef &&
      match.enrolledContractRef
    ) {
      refs.set(row.id, match.enrolledContractRef);
    }
  });
  return refs;
}

export function applyEnrolledRefs(
  parts: TicketPartRow[],
  refs: Map<string, string>,
): TicketPartRow[] {
  if (refs.size === 0) return parts;
  let changed = false;
  const next = parts.map((row) => {
    const ref = refs.get(row.id);
    if (!ref || row.lineType !== "agreement" || row.enrolledContractRef) {
      return row;
    }
    changed = true;
    return { ...row, enrolledContractRef: ref };
  });
  return changed ? next : parts;
}

/**
 * Copies ids the server assigned during a save (ticket number, created
 * equipment, enrolled agreements) into the form without touching fields the
 * user changed while the save was running.
 */
export function mergeSavedTicket(
  current: TicketFormState,
  sent: TicketFormState,
  saved: TicketFormState,
): TicketFormState {
  const number = current.number || saved.number;
  const customerRef = current.customerRef || saved.customerRef;
  const equipmentRef =
    current.equipmentRef === sent.equipmentRef && saved.equipmentRef
      ? saved.equipmentRef
      : current.equipmentRef;
  const parts = applyEnrolledRefs(
    current.parts,
    enrolledRefsFromSave(sent.parts, saved.parts),
  );
  if (
    number === current.number &&
    customerRef === current.customerRef &&
    equipmentRef === current.equipmentRef &&
    parts === current.parts
  ) {
    return current;
  }
  return { ...current, number, customerRef, equipmentRef, parts };
}

export function ticketToPayload(form: TicketFormState) {
  const totals = ticketTotals(form);
  return {
    customerId: form.customerId ?? 0,
    addressRef: form.addressRef || null,
    equipmentRef: form.equipmentRef || null,
    descPerform: form.descPerform,
    date: form.date || null,
    startTime: form.startTime.trim(),
    endTime: form.endTime.trim(),
    tech: form.tech,
    assignedUserRef: form.assignedUserRef || null,
    workOrderTypeRef: form.workOrderTypeRef || null,
    paid: form.paid,
    completed: form.completed,
    runHours: parseMoney(form.runHours),
    laborHours: totals.laborHours,
    totalLabor: totals.totalLabor,
    laborOverridden: form.laborOverridden && !hasLaborProductLines(form.parts),
    miscExp: totals.miscExp,
    shipping: totals.shipping,
    parts: form.parts
      .filter(isPersistedTicketRow)
      .map((row) =>
        row.lineType === "note"
          ? {
              productRef: null,
              contractTemplateRef: null,
              enrolledContractRef: null,
              lineType: "note" as const,
              kind: "part" as const,
              partNumber: "",
              description: row.description.trim(),
              quantity: 0,
              unitPrice: 0,
              listPrice: 0,
              priceOverridden: false,
              amount: 0,
            }
          : row.lineType === "agreement"
            ? {
                productRef: null,
                contractTemplateRef: row.contractTemplateRef || null,
                enrolledContractRef: row.enrolledContractRef || null,
                lineType: "agreement" as const,
                kind: "part" as const,
                partNumber: "",
                description: row.description.trim(),
                quantity: parseMoney(row.quantity),
                unitPrice: parseMoney(row.unitPrice),
                listPrice: parseMoney(row.listPrice),
                priceOverridden: row.priceOverridden,
                amount: partAmount(row),
              }
            : {
                productRef: row.productRef || null,
                contractTemplateRef: null,
                enrolledContractRef: null,
                lineType: "product" as const,
                kind: row.kind,
                partNumber: row.partNumber.trim(),
                description: row.description.trim(),
                quantity: parseMoney(row.quantity),
                unitPrice: parseMoney(row.unitPrice),
                listPrice: parseMoney(row.listPrice),
                priceOverridden: row.priceOverridden,
                amount: partAmount(row),
              },
      ),
    customerName: form.customerName,
    customerAddress: form.customerAddress,
    customerCity: form.customerCity,
    customerState: form.customerState,
    customerZip: form.customerZip,
    customerPhone: form.customerPhone,
    customerEmail: form.customerEmail,
    workPhone: form.workPhone,
    serialNumber: form.serialNumber,
    generatorModel: form.generatorModel,
    exerciseDay: form.exerciseDay,
    exerciseTime: form.exerciseTime,
    signatureDataUrl: form.signatureDataUrl,
    signedByName: form.signedByName,
    status: form.status,
    contractRef: form.contractRef || null,
    contractDiscount: form.contractDiscount,
  };
}

export function ticketFromRecord(record: {
  number?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  tech?: string | null;
  assignedUserRef?: string | null;
  workOrderTypeRef?: string | null;
  workOrderType?: { _id: string; label: string } | null;
  customerId?: number | null;
  customerRef?: string | null;
  addressRef?: string | null;
  equipmentRef?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
  customerState?: string | null;
  customerZip?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  workPhone?: string | null;
  serialNumber?: string | null;
  generatorModel?: string | null;
  exerciseDay?: string | null;
  exerciseTime?: string | null;
  paid?: boolean;
  runHours?: number | null;
  laborHours?: number | null;
  laborOverridden?: boolean;
  totalLabor?: number | null;
  descPerform?: string | null;
  descPerformed?: string | null;
  parts?: Array<{
    productRef?: string | null;
    contractTemplateRef?: string | null;
    enrolledContractRef?: string | null;
    lineType?: TicketLineType;
    kind?: TicketProductKind | "contract";
    partNumber?: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
    listPrice?: number;
    priceOverridden?: boolean;
  }>;
  miscExp?: number | null;
  shipping?: number | null;
  signatureDataUrl?: string | null;
  signedByName?: string | null;
  completed?: boolean;
  status?: TicketFormState["status"];
  contractRef?: string | null;
  contractDiscount?: TicketContractDiscount | null;
}): TicketFormState {
  const base = emptyTicketForm();
  const parts = (record.parts ?? []).map((part) => ({
    id: newRowId(),
    lineType:
      part.lineType === "note"
        ? ("note" as const)
        : part.lineType === "agreement"
          ? ("agreement" as const)
          : ("product" as const),
    kind:
      part.lineType === "product" && part.kind === "labor"
        ? ("labor" as const)
        : part.lineType === "product" && part.kind === "equipment"
          ? ("equipment" as const)
          : ("part" as const),
    productRef: part.productRef ?? "",
    contractTemplateRef: part.contractTemplateRef ?? "",
    enrolledContractRef: part.enrolledContractRef ?? "",
    partNumber: part.partNumber ?? "",
    description: part.description ?? "",
    quantity: part.quantity ? String(part.quantity) : "",
    listPrice: part.listPrice ? String(part.listPrice) : part.unitPrice ? String(part.unitPrice) : "",
    unitPrice: part.unitPrice ? String(part.unitPrice) : "",
    priceOverridden: Boolean(part.priceOverridden),
  }));
  return {
    ...base,
    number: record.number ?? "",
    date: record.date ? String(record.date).slice(0, 10) : base.date,
    startTime: record.startTime ?? "",
    endTime: record.endTime ?? "",
    tech: record.tech ?? "",
    assignedUserRef: record.assignedUserRef ?? null,
    workOrderTypeRef:
      record.workOrderTypeRef ?? record.workOrderType?._id ?? null,
    workOrderTypeLabel: record.workOrderType?.label ?? "",
    trackedEquipment: parts.some(
      (row) => row.lineType === "product" && row.kind === "equipment",
    ),
    customerRef: record.customerRef ?? "",
    customerId: record.customerId ?? null,
    addressRef: record.addressRef ?? "",
    equipmentRef: record.equipmentRef ?? "",
    customerName: record.customerName ?? "",
    customerAddress: record.customerAddress ?? "",
    customerCity: record.customerCity ?? "",
    customerState: record.customerState?.trim()
      ? toUsStateCode(record.customerState)
      : "",
    customerZip: record.customerZip ?? "",
    customerPhone: record.customerPhone ?? "",
    customerEmail: record.customerEmail ?? "",
    workPhone: record.workPhone ?? "",
    serialNumber: record.serialNumber ?? "",
    generatorModel: record.generatorModel ?? "",
    exerciseDay: record.exerciseDay ?? "",
    exerciseTime: record.exerciseTime ?? "",
    paid: Boolean(record.paid),
    runHours: record.runHours ? String(record.runHours) : "",
    laborHours: record.laborHours ? String(record.laborHours) : "",
    laborOverridden: Boolean(record.laborOverridden),
    totalLabor: record.totalLabor ? String(record.totalLabor) : "",
    descPerform: record.descPerform ?? "",
    descPerformed: record.descPerformed ?? "",
    parts: withTrailingEmptyProduct(parts),
    miscExp: record.miscExp ? String(record.miscExp) : "",
    shipping: record.shipping ? String(record.shipping) : "",
    signatureDataUrl: record.signatureDataUrl ?? "",
    signedByName: record.signedByName ?? "",
    completed: Boolean(record.completed),
    status: record.status ?? "draft",
    contractRef: record.contractRef ?? "",
    contractDiscount: record.contractDiscount ?? null,
  };
}

export function applyEstimateTemplate(
  form: TicketFormState,
  template: {
    descPerform?: string | null;
    laborHours?: number | null;
    parts?: Parameters<typeof ticketFromRecord>[0]["parts"];
  } | null,
): TicketFormState {
  if (!template) {
    return {
      ...form,
      descPerform: "",
      laborHours: "",
      laborOverridden: false,
      totalLabor: "",
      parts: withTrailingEmptyProduct([]),
    };
  }

  const mapped = ticketFromRecord({
    descPerform: template.descPerform,
    laborHours: template.laborHours,
    parts: template.parts,
  });

  return {
    ...form,
    descPerform: mapped.descPerform,
    laborHours: mapped.laborHours,
    laborOverridden: false,
    totalLabor: "",
    parts: withTrailingEmptyProduct(mapped.parts.filter((row) => !isBlankProductRow(row))),
  };
}

export const SERVICE_TICKET_TERMS = `Payment is due upon completion of work unless otherwise agreed in writing. Generator Maintenance of Florida is not liable for incidental or consequential damages, including loss of food, property, or business interruption. A 3% convenience fee applies to credit card payments. Checks may be mailed to Generator Maintenance of Florida.`;
