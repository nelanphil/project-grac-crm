import { Types } from "mongoose";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  pickLatestAvailableInvoice,
  type InvoiceAvailabilityInput,
  type WorkOrderAvailability,
} from "./paymentLinkSelection";

const PAYABLE_INVOICE_STATUSES = ["open", "draft", "failed"] as const;

export type PaymentLinkInvoice = InvoiceAvailabilityInput & {
  _id: unknown;
  customerRef?: unknown;
  number?: string;
  amountCents?: number;
  lineItems?: Array<{ description?: string }>;
  sourceType?: string;
  status: string;
};

function uniqueCustomerIds(customerIds: string[]): Types.ObjectId[] {
  return [
    ...new Set(customerIds.filter((id) => Types.ObjectId.isValid(id))),
  ].map((id) => new Types.ObjectId(id));
}

export async function pickAvailableInvoicesForCustomers(
  customerIds: string[],
  now: Date = new Date(),
): Promise<Map<string, PaymentLinkInvoice>> {
  const objectIds = uniqueCustomerIds(customerIds);
  const picked = new Map<string, PaymentLinkInvoice>();
  if (objectIds.length === 0) return picked;

  const invoices = (await Invoice.find({
    customerRef: { $in: objectIds },
    status: { $in: PAYABLE_INVOICE_STATUSES },
  }).lean()) as PaymentLinkInvoice[];

  const workOrderIds = invoices
    .filter((invoice) => invoice.sourceType === "work_order" && invoice.workOrderRef)
    .map((invoice) => invoice.workOrderRef);
  const workOrders = workOrderIds.length
    ? await WorkOrder.find({ _id: { $in: workOrderIds } })
        .select("completed deletedAt")
        .lean()
    : [];
  const workOrdersById = new Map<string, WorkOrderAvailability>(
    workOrders.map((workOrder) => [
      String(workOrder._id),
      {
        completed: workOrder.completed,
        deletedAt: workOrder.deletedAt,
      },
    ]),
  );

  const byCustomer = new Map<string, PaymentLinkInvoice[]>();
  for (const invoice of invoices) {
    const customerId = invoice.customerRef ? String(invoice.customerRef) : "";
    if (!customerId) continue;
    const group = byCustomer.get(customerId) ?? [];
    group.push(invoice);
    byCustomer.set(customerId, group);
  }
  for (const [customerId, group] of byCustomer) {
    const invoice = pickLatestAvailableInvoice(group, workOrdersById, now);
    if (invoice) picked.set(customerId, invoice);
  }
  return picked;
}
