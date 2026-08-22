export const LABOR_INCLUDED_MINUTES = 30;
export const LABOR_BLOCK_MINUTES = 30;
export const LABOR_BLOCK_RATE = 75;
export const PART_ROW_COUNT = 10;

export type TicketVariant = "work-order" | "estimate";

export interface TicketPartRow {
  productRef: string;
  partNumber: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface TicketFormState {
  number: string;
  date: string;
  tech: string;
  customerRef: string;
  customerId: number | null;
  addressRef: string;
  equipmentRef: string;
  customerName: string;
  customerAddress: string;
  customerCity: string;
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
}

export function emptyPartRow(): TicketPartRow {
  return {
    productRef: "",
    partNumber: "",
    description: "",
    quantity: "",
    unitPrice: "",
  };
}

export function emptyTicketForm(): TicketFormState {
  return {
    number: "",
    date: new Date().toISOString().slice(0, 10),
    tech: "",
    customerRef: "",
    customerId: null,
    addressRef: "",
    equipmentRef: "",
    customerName: "",
    customerAddress: "",
    customerCity: "",
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
    parts: Array.from({ length: PART_ROW_COUNT }, emptyPartRow),
    miscExp: "",
    shipping: "",
    signatureDataUrl: "",
    signedByName: "",
    completed: false,
    status: "draft",
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

export function partAmount(row: TicketPartRow): number {
  return Math.round(parseMoney(row.quantity) * parseMoney(row.unitPrice) * 100) / 100;
}

export function ticketTotals(form: TicketFormState) {
  const totalParts = form.parts.reduce((sum, row) => sum + partAmount(row), 0);
  const laborHours = parseMoney(form.laborHours);
  const totalLabor = form.laborOverridden
    ? parseMoney(form.totalLabor)
    : defaultLaborTotal(laborHours);
  const miscExp = parseMoney(form.miscExp);
  const shipping = parseMoney(form.shipping);
  const subtotal = Math.round((totalParts + totalLabor + miscExp) * 100) / 100;
  const total = Math.round((subtotal + shipping) * 100) / 100;
  return { totalParts, totalLabor, miscExp, shipping, subtotal, total, laborHours };
}

export function ticketToPayload(form: TicketFormState) {
  const totals = ticketTotals(form);
  return {
    customerId: form.customerId ?? 0,
    addressRef: form.addressRef || null,
    equipmentRef: form.equipmentRef || null,
    descPerform: form.descPerform,
    descPerformed: form.descPerformed,
    date: form.date || null,
    tech: form.tech,
    paid: form.paid,
    completed: form.completed,
    runHours: parseMoney(form.runHours),
    laborHours: totals.laborHours,
    totalLabor: totals.totalLabor,
    laborOverridden: form.laborOverridden,
    miscExp: totals.miscExp,
    shipping: totals.shipping,
    parts: form.parts
      .filter(
        (row) =>
          row.partNumber.trim() ||
          row.description.trim() ||
          parseMoney(row.quantity) > 0 ||
          parseMoney(row.unitPrice) > 0,
      )
      .map((row) => ({
        productRef: row.productRef || null,
        partNumber: row.partNumber.trim(),
        description: row.description.trim(),
        quantity: parseMoney(row.quantity),
        unitPrice: parseMoney(row.unitPrice),
        amount: partAmount(row),
      })),
    customerName: form.customerName,
    customerAddress: form.customerAddress,
    customerCity: form.customerCity,
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
  };
}

export function ticketFromRecord(record: {
  number?: string | null;
  date?: string | null;
  tech?: string | null;
  customerId?: number | null;
  customerRef?: string | null;
  addressRef?: string | null;
  equipmentRef?: string | null;
  customerName?: string | null;
  customerAddress?: string | null;
  customerCity?: string | null;
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
    partNumber?: string;
    description?: string;
    quantity?: number;
    unitPrice?: number;
  }>;
  miscExp?: number | null;
  shipping?: number | null;
  signatureDataUrl?: string | null;
  signedByName?: string | null;
  completed?: boolean;
  status?: TicketFormState["status"];
}): TicketFormState {
  const base = emptyTicketForm();
  const parts = (record.parts ?? []).map((part) => ({
    productRef: part.productRef ?? "",
    partNumber: part.partNumber ?? "",
    description: part.description ?? "",
    quantity: part.quantity ? String(part.quantity) : "",
    unitPrice: part.unitPrice ? String(part.unitPrice) : "",
  }));
  while (parts.length < PART_ROW_COUNT) parts.push(emptyPartRow());
  return {
    ...base,
    number: record.number ?? "",
    date: record.date ? String(record.date).slice(0, 10) : base.date,
    tech: record.tech ?? "",
    customerRef: record.customerRef ?? "",
    customerId: record.customerId ?? null,
    addressRef: record.addressRef ?? "",
    equipmentRef: record.equipmentRef ?? "",
    customerName: record.customerName ?? "",
    customerAddress: record.customerAddress ?? "",
    customerCity: record.customerCity ?? "",
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
    parts,
    miscExp: record.miscExp ? String(record.miscExp) : "",
    shipping: record.shipping ? String(record.shipping) : "",
    signatureDataUrl: record.signatureDataUrl ?? "",
    signedByName: record.signedByName ?? "",
    completed: Boolean(record.completed),
    status: record.status ?? "draft",
  };
}

export const SERVICE_TICKET_TERMS = `Payment is due upon completion of work unless otherwise agreed in writing. Generator Maintenance of Florida is not liable for incidental or consequential damages, including loss of food, property, or business interruption. A 3% convenience fee applies to credit card payments. Checks may be mailed to Generator Maintenance of Florida.`;
