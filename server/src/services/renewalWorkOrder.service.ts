import { PipelineStage, Types } from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import {
  Customer,
  excludeDeletedCustomerRefs,
  loadDeletedCustomerIds,
} from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { Equipment } from "../models/mongo/Equipment";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { WorkOrder, type IWorkOrder } from "../models/mongo/WorkOrder";
import { logNotificationAsync } from "./notification.service";
import { nextPrefixedNumber } from "./serviceTicket";
import { resolveTicketWorkOrderType } from "./ticketWorkOrderType";
import { recordWorkOrderActivity } from "./workOrderActivity.service";
import { formatLocalDate, storedTicketDateKey } from "../utils/scheduleTime";

const RENEWAL_VISIT_MINUTES = 30;

/** Paid invoices of these kinds get a service visit work order. */
export const CONTRACT_SERVICE_SOURCE_TYPES = [
  "contract_renewal",
  "contract_initial",
] as const;

export function isContractServiceInvoice(
  sourceType: string | null | undefined,
): boolean {
  return CONTRACT_SERVICE_SOURCE_TYPES.some((type) => type === sourceType);
}

export class RenewalWorkOrderError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "RenewalWorkOrderError";
    this.status = status;
  }
}

export type RenewalWorkOrderActor = {
  actorUserId?: string | null;
  actorName?: string | null;
};

export type RenewalWorkOrderResult = {
  workOrderId: string;
  number: string;
  created: boolean;
};

export type RenewalVisitWorkOrder = {
  date?: Date | null;
  scheduledStart?: Date | null;
  deletedAt?: Date | null;
} | null | undefined;

/** A renewal visit is set once it has a ticket date or a dispatch time. */
export function isRenewalVisitScheduled(workOrder: RenewalVisitWorkOrder): boolean {
  if (!workOrder || workOrder.deletedAt) return false;
  return Boolean(workOrder.date || workOrder.scheduledStart);
}

export type RenewalVisitState = {
  workOrderId: string | null;
  workOrderNumber: string | null;
  scheduled: boolean;
  date: string | null;
};

export async function renewalVisitState(invoice: {
  serviceWorkOrderRef?: Types.ObjectId | string | null;
}): Promise<RenewalVisitState> {
  const id = invoice.serviceWorkOrderRef ? String(invoice.serviceWorkOrderRef) : "";
  if (!id || !Types.ObjectId.isValid(id)) {
    return {
      workOrderId: null,
      workOrderNumber: null,
      scheduled: false,
      date: null,
    };
  }
  const workOrder = await WorkOrder.findById(id)
    .select("number date scheduledStart deletedAt")
    .lean();
  if (!workOrder || workOrder.deletedAt) {
    return {
      workOrderId: null,
      workOrderNumber: null,
      scheduled: false,
      date: null,
    };
  }
  const ticketDate = workOrder.date ? new Date(workOrder.date) : null;
  const date =
    storedTicketDateKey(ticketDate) ??
    (workOrder.scheduledStart
      ? formatLocalDate(new Date(workOrder.scheduledStart))
      : null);
  return {
    workOrderId: String(workOrder._id),
    workOrderNumber: workOrder.number ?? null,
    scheduled: isRenewalVisitScheduled({
      date: ticketDate,
      scheduledStart: workOrder.scheduledStart
        ? new Date(workOrder.scheduledStart)
        : null,
      deletedAt: workOrder.deletedAt ? new Date(workOrder.deletedAt) : null,
    }),
    date,
  };
}

export type RenewalWorkOrderGateway = {
  loadInvoice(id: string): Promise<{
    status: string;
    sourceType: string;
    serviceWorkOrderRef: string | null;
    dismissed: boolean;
  } | null>;
  loadExistingWorkOrder(
    id: string,
  ): Promise<{ id: string; number: string } | null>;
  createWorkOrder(invoiceId: string): Promise<{ id: string; number: string }>;
  linkIfUnset(invoiceId: string, workOrderId: string): Promise<boolean>;
  readLinkedRef(invoiceId: string): Promise<string | null>;
  discardWorkOrder(id: string): Promise<void>;
  afterLink?(workOrderId: string, invoiceId: string): Promise<void>;
};

/**
 * Paid contract invoices belong on the Paid Renewals report when they still
 * need a visit: no work order yet, or a linked work order with no date and
 * no dispatch time. A completed visit, or any visit that already has a date,
 * stays off the report. `referenceAt` is the payment time, or the issue time
 * when paidAt is missing.
 */
export function invoiceNeedsRenewalReportRow(input: {
  sourceType: string;
  status: string;
  serviceWorkOrderRef?: string | null;
  dismissedAt?: Date | null;
  referenceAt?: Date | null;
  laterWorkOrderCreatedAt?: Date | null;
  /** False when the linked work order still needs a date. Omitted means it does not belong on the report. */
  linkedWorkOrderScheduled?: boolean | null;
  linkedWorkOrderCompleted?: boolean;
}): boolean {
  if (!isContractServiceInvoice(input.sourceType)) return false;
  if (input.status !== "paid") return false;
  if (input.dismissedAt) return false;
  if (input.serviceWorkOrderRef) {
    if (input.linkedWorkOrderCompleted) return false;
    return input.linkedWorkOrderScheduled === false;
  }
  if (
    input.referenceAt &&
    input.laterWorkOrderCreatedAt &&
    input.laterWorkOrderCreatedAt.getTime() >= input.referenceAt.getTime()
  ) {
    return false;
  }
  return true;
}

/** Payment stays paid even when the visit cannot be created. */
export async function runRenewalWorkOrderSideEffect(
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error("[renewal-work-order] failed", err);
  }
}

/**
 * Creates at most one work order. A second caller, including one that raced
 * the insert, keeps the work order that won the invoice link and discards its own.
 */
export async function performRenewalWorkOrderEnsure(
  invoiceId: string,
  gateway: RenewalWorkOrderGateway,
): Promise<RenewalWorkOrderResult | null> {
  const invoice = await gateway.loadInvoice(invoiceId);
  if (
    !invoice ||
    invoice.status !== "paid" ||
    !isContractServiceInvoice(invoice.sourceType) ||
    invoice.dismissed
  ) {
    return null;
  }
  if (invoice.serviceWorkOrderRef) {
    const existing = await gateway.loadExistingWorkOrder(
      invoice.serviceWorkOrderRef,
    );
    if (existing) {
      return {
        workOrderId: existing.id,
        number: existing.number,
        created: false,
      };
    }
  }

  const created = await gateway.createWorkOrder(invoiceId);
  const linked = await gateway.linkIfUnset(invoiceId, created.id);
  if (linked) {
    await gateway.afterLink?.(created.id, invoiceId);
    return {
      workOrderId: created.id,
      number: created.number,
      created: true,
    };
  }

  await gateway.discardWorkOrder(created.id);
  const winner = await gateway.readLinkedRef(invoiceId);
  if (!winner) return null;
  const existing = await gateway.loadExistingWorkOrder(winner);
  return {
    workOrderId: existing?.id ?? winner,
    number: existing?.number ?? "",
    created: false,
  };
}

function customerLabel(customer: {
  accountName?: string | null;
  first?: string | null;
  last?: string | null;
  legacyId?: number | null;
}): string {
  const account = (customer.accountName ?? "").trim();
  if (account) return account;
  const name = `${customer.first ?? ""} ${customer.last ?? ""}`.trim();
  return name || (customer.legacyId ? `Customer #${customer.legacyId}` : "Customer");
}

function templateLabelOf(invoice: IInvoice): string {
  const label = invoice.metadata?.templateLabel;
  return typeof label === "string" ? label.trim() : "";
}

async function buildRenewalWorkOrder(
  invoice: IInvoice,
): Promise<IWorkOrder | null> {
  const customer = invoice.customerRef
    ? await Customer.findOne({ _id: invoice.customerRef, deletedAt: null })
    : await Customer.findOne({
        legacyId: invoice.customerId,
        deletedAt: null,
        $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
      });
  if (!customer) return null;

  const contract = invoice.contractRef
    ? await Contract.findById(invoice.contractRef)
    : null;
  const [site, equipment, contact, template] = await Promise.all([
    contract?.addressRef
      ? CustomerAddress.findById(contract.addressRef).lean()
      : null,
    contract?.equipmentRef
      ? Equipment.findById(contract.equipmentRef).lean()
      : null,
    CustomerContact.findOne({
      customerRef: customer._id,
      ...activeContactFilter,
    })
      .sort({ isPrimary: -1, createdAt: 1 })
      .select("phone email")
      .lean(),
    !templateLabelOf(invoice) && (contract?.templateId || invoice.templateRef)
      ? ContractTemplate.findById(contract?.templateId ?? invoice.templateRef)
          .select("label")
          .lean()
      : null,
  ]);

  const label = templateLabelOf(invoice) || template?.label?.trim() || "";
  const visitLabel =
    invoice.sourceType === "contract_initial" ? "new contract" : "renewal";
  const description = `ASC ${visitLabel} service (invoice ${invoice.number}${
    label ? `, ${label}` : ""
  })`;
  const typeRef = await resolveTicketWorkOrderType({
    requestedRef: null,
    parts: [],
    emptyWithoutEquipment: "service",
  });
  if (!typeRef.ok) {
    console.warn(
      `[renewal-work-order] No service type for invoice ${invoice.number}: ${typeRef.message}`,
    );
  }

  const workOrder = new WorkOrder({
    customerId: customer.legacyId ?? invoice.customerId,
    customerRef: customer._id,
    addressRef: site?._id ?? contract?.addressRef ?? null,
    equipmentRef: equipment?._id ?? contract?.equipmentRef ?? null,
    contractRef: contract?._id ?? invoice.contractRef ?? null,
    renewalInvoiceRef: invoice._id,
    number: await nextPrefixedNumber(WorkOrder, "WO"),
    origin: "user",
    descPerform: description,
    descPerformed: "",
    paid: true,
    date: null,
    scheduledStart: null,
    scheduledEnd: null,
    estimatedMinutes: RENEWAL_VISIT_MINUTES,
    customerName: customerLabel(customer),
    customerAddress: site?.address || customer.address || "",
    customerCity: site?.city || customer.city || "",
    customerState: site?.state || customer.state || "FL",
    customerZip: site?.zip || customer.zip || "",
    customerPhone: (contact?.phone || customer.phone || "").trim(),
    customerEmail: (contact?.email || customer.email || "").trim(),
    serialNumber: equipment?.serial || customer.serial || "",
    generatorModel: equipment?.generatorModel || customer.generatorModel || "",
    exerciseDay: equipment?.exday || customer.exday || "",
    exerciseTime: equipment?.extime || customer.extime || "",
    workOrderTypeRef: typeRef.ok ? typeRef.ref : null,
    parts: [],
    totalParts: 0,
    totalLabor: 0,
    totalAgreements: 0,
    subtotal: 0,
    shipping: 0,
    tax: 0,
    total: 0,
  });
  await workOrder.save();
  return workOrder;
}

async function rememberWorkOrderOnContract(
  invoice: IInvoice,
  workOrderId: Types.ObjectId,
): Promise<void> {
  if (!invoice.contractRef) return;
  await Contract.updateOne(
    { _id: invoice.contractRef, "renewals.invoiceRef": invoice._id },
    { $set: { "renewals.$.workOrderRef": workOrderId } },
  );
}

function mongooseGateway(
  actor?: RenewalWorkOrderActor,
): RenewalWorkOrderGateway {
  return {
    async loadInvoice(id) {
      const invoice = await Invoice.findById(id)
        .select(
          "status sourceType serviceWorkOrderRef renewalWorkOrderDismissedAt",
        )
        .lean();
      if (!invoice) return null;
      return {
        status: invoice.status,
        sourceType: invoice.sourceType,
        serviceWorkOrderRef: invoice.serviceWorkOrderRef
          ? String(invoice.serviceWorkOrderRef)
          : null,
        dismissed: Boolean(invoice.renewalWorkOrderDismissedAt),
      };
    },
    async loadExistingWorkOrder(id) {
      if (!Types.ObjectId.isValid(id)) return null;
      const workOrder = await WorkOrder.findById(id).select("number").lean();
      if (!workOrder) return null;
      return { id: String(workOrder._id), number: workOrder.number ?? "" };
    },
    async createWorkOrder(invoiceId) {
      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) throw new RenewalWorkOrderError("Invoice not found", 404);
      const workOrder = await buildRenewalWorkOrder(invoice);
      if (!workOrder) {
        throw new RenewalWorkOrderError(
          "Could not create a work order for this invoice",
        );
      }
      return { id: String(workOrder._id), number: workOrder.number ?? "" };
    },
    async linkIfUnset(invoiceId, workOrderId) {
      const linked = await Invoice.findOneAndUpdate(
        { _id: invoiceId, serviceWorkOrderRef: null },
        { $set: { serviceWorkOrderRef: new Types.ObjectId(workOrderId) } },
      );
      return Boolean(linked);
    },
    async readLinkedRef(invoiceId) {
      const invoice = await Invoice.findById(invoiceId)
        .select("serviceWorkOrderRef")
        .lean();
      return invoice?.serviceWorkOrderRef
        ? String(invoice.serviceWorkOrderRef)
        : null;
    },
    async discardWorkOrder(id) {
      await WorkOrder.updateOne(
        { _id: id },
        { $set: { deletedAt: new Date() } },
      );
    },
    async afterLink(workOrderId, invoiceId) {
      const invoice = await Invoice.findById(invoiceId);
      if (!invoice) return;
      const workOrderRef = new Types.ObjectId(workOrderId);
      await rememberWorkOrderOnContract(invoice, workOrderRef);
      const kind =
        invoice.sourceType === "contract_initial" ? "contract" : "renewal";
      await recordWorkOrderActivity({
        workOrderRef,
        action: "created",
        actor: {
          actorKind: actor?.actorUserId ? "staff" : "system",
          actorUserId: actor?.actorUserId ?? null,
          actorName: actor?.actorName ?? null,
        },
        summary: `Created for paid ASC ${kind} ${invoice.number}`,
        source: actor?.actorUserId ? "crm" : "job",
      });
      logNotificationAsync({
        entityType: "work_order",
        action: "created",
        entityId: workOrderId,
        customerRef: invoice.customerRef ?? null,
        summary: `Work order created for paid ${kind} ${invoice.number}`,
        actorType: actor?.actorUserId ? "user" : "system",
        actorUserId: actor?.actorUserId ?? null,
        actorName: actor?.actorName ?? (actor?.actorUserId ? undefined : "System"),
      });
    },
  };
}

export async function ensureRenewalWorkOrder(
  invoice: { _id: Types.ObjectId | string },
  actor?: RenewalWorkOrderActor,
): Promise<RenewalWorkOrderResult | null> {
  return performRenewalWorkOrderEnsure(String(invoice._id), mongooseGateway(actor));
}

export async function findPaidRenewalsWithoutWorkOrder(input?: {
  number?: RegExp;
  customerRefs?: Types.ObjectId[];
  skip?: number;
  limit?: number;
  /** Also include paid contracts whose work order exists but has no date yet. */
  includeUnscheduled?: boolean;
}): Promise<{ invoices: Array<Record<string, unknown>>; total: number }> {
  const match: Record<string, unknown> = {
    sourceType: { $in: [...CONTRACT_SERVICE_SOURCE_TYPES] },
    status: "paid",
    renewalWorkOrderDismissedAt: null,
    ...excludeDeletedCustomerRefs(await loadDeletedCustomerIds()),
  };
  if (!input?.includeUnscheduled) {
    match.serviceWorkOrderRef = null;
  }
  if (input?.number || (input?.customerRefs && input.customerRefs.length > 0)) {
    const or: Record<string, unknown>[] = [];
    if (input.number) or.push({ number: input.number });
    if (input.customerRefs && input.customerRefs.length > 0) {
      or.push({ customerRef: { $in: input.customerRefs } });
    }
    match.$or = or;
  }

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: WorkOrder.collection.name,
        let: {
          customerRef: "$customerRef",
          referenceAt: { $ifNull: ["$paidAt", "$issuedAt"] },
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $ne: ["$$customerRef", null] },
                  { $eq: ["$customerRef", "$$customerRef"] },
                  { $gte: ["$createdAt", "$$referenceAt"] },
                  { $eq: [{ $ifNull: ["$deletedAt", null] }, null] },
                ],
              },
            },
          },
          { $limit: 1 },
          { $project: { _id: 1 } },
        ],
        as: "laterWorkOrders",
      },
    },
  ] as PipelineStage[];

  if (input?.includeUnscheduled) {
    pipeline.push(
      {
        $lookup: {
          from: WorkOrder.collection.name,
          let: { workOrderId: "$serviceWorkOrderRef" },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ["$$workOrderId", null] },
                    { $eq: ["$_id", "$$workOrderId"] },
                    { $eq: [{ $ifNull: ["$deletedAt", null] }, null] },
                    { $ne: ["$completed", true] },
                    { $eq: [{ $ifNull: ["$date", null] }, null] },
                    { $eq: [{ $ifNull: ["$scheduledStart", null] }, null] },
                  ],
                },
              },
            },
            { $limit: 1 },
            { $project: { _id: 1, number: 1 } },
          ],
          as: "linkedWorkOrders",
        },
      },
      {
        $match: {
          $or: [
            { serviceWorkOrderRef: null, laterWorkOrders: { $size: 0 } },
            { "linkedWorkOrders.0": { $exists: true } },
          ],
        },
      },
      {
        $addFields: {
          scheduleWorkOrder: {
            $let: {
              vars: { visit: { $arrayElemAt: ["$linkedWorkOrders", 0] } },
              in: {
                $cond: [
                  { $ifNull: ["$$visit", false] },
                  { _id: "$$visit._id", number: "$$visit.number" },
                  null,
                ],
              },
            },
          },
        },
      },
      { $project: { laterWorkOrders: 0, linkedWorkOrders: 0 } },
    );
  } else {
    pipeline.push(
      { $match: { laterWorkOrders: { $size: 0 } } },
      { $project: { laterWorkOrders: 0 } },
    );
  }

  pipeline.push({ $sort: { paidAt: -1, issuedAt: -1, createdAt: -1 } });

  if (input?.limit == null) {
    const invoices = await Invoice.aggregate(pipeline);
    return { invoices, total: invoices.length };
  }

  const [result] = await Invoice.aggregate([
    ...pipeline,
    {
      $facet: {
        invoices: [{ $skip: input.skip ?? 0 }, { $limit: input.limit }],
        total: [{ $count: "count" }],
      },
    },
  ]);
  return {
    invoices: result?.invoices ?? [],
    total: result?.total?.[0]?.count ?? 0,
  };
}

async function paidRenewalInvoice(id: string): Promise<IInvoice> {
  if (!Types.ObjectId.isValid(id)) {
    throw new RenewalWorkOrderError("Invalid invoice id");
  }
  const invoice = await Invoice.findById(id);
  if (!invoice) throw new RenewalWorkOrderError("Invoice not found", 404);
  if (!isContractServiceInvoice(invoice.sourceType) || invoice.status !== "paid") {
    throw new RenewalWorkOrderError("This is not a paid contract invoice");
  }
  return invoice;
}

export async function linkRenewalWorkOrder(input: {
  invoiceId: string;
  workOrderId?: string | null;
  workOrderNumber?: string | null;
  actor?: RenewalWorkOrderActor;
}): Promise<RenewalWorkOrderResult> {
  const invoice = await paidRenewalInvoice(input.invoiceId);
  if (invoice.serviceWorkOrderRef) {
    throw new RenewalWorkOrderError("This invoice already has a work order");
  }
  const rawId = input.workOrderId?.trim() ?? "";
  const rawNumber = input.workOrderNumber?.trim() ?? "";
  const asId = /^[a-fA-F0-9]{24}$/;
  let workOrder: IWorkOrder | null = null;
  if (rawId && asId.test(rawId)) {
    workOrder = await WorkOrder.findById(rawId);
  }
  if (!workOrder && rawNumber && asId.test(rawNumber)) {
    workOrder = await WorkOrder.findById(rawNumber);
  }
  if (!workOrder && rawNumber) {
    workOrder = await WorkOrder.findOne({ number: rawNumber });
  }
  if (!workOrder) {
    throw new RenewalWorkOrderError("Work order not found", 404);
  }
  const sameCustomer = invoice.customerRef && workOrder.customerRef
    ? String(invoice.customerRef) === String(workOrder.customerRef)
    : invoice.customerId === workOrder.customerId;
  if (!sameCustomer) {
    throw new RenewalWorkOrderError(
      "That work order belongs to a different customer",
    );
  }

  const linked = await Invoice.findOneAndUpdate(
    { _id: invoice._id, serviceWorkOrderRef: null },
    {
      $set: {
        serviceWorkOrderRef: workOrder._id,
        renewalWorkOrderDismissedAt: null,
        renewalWorkOrderDismissedBy: null,
      },
    },
  );
  if (!linked) {
    throw new RenewalWorkOrderError("This invoice already has a work order");
  }

  if (!workOrder.renewalInvoiceRef) workOrder.renewalInvoiceRef = invoice._id;
  if (!workOrder.contractRef && invoice.contractRef) {
    workOrder.contractRef = invoice.contractRef;
  }
  if (!workOrder.paid) workOrder.paid = true;
  await workOrder.save();
  await rememberWorkOrderOnContract(invoice, workOrder._id as Types.ObjectId);
  await recordWorkOrderActivity({
    workOrderRef: workOrder._id,
    action: "updated",
    actor: {
      actorKind: "staff",
      actorUserId: input.actor?.actorUserId ?? null,
      actorName: input.actor?.actorName ?? null,
    },
    summary: `Linked to paid renewal ${invoice.number}`,
    source: "crm",
  });
  return {
    workOrderId: String(workOrder._id),
    number: workOrder.number ?? "",
    created: false,
  };
}

export async function dismissPaidRenewal(input: {
  invoiceId: string;
  actor?: RenewalWorkOrderActor;
}): Promise<void> {
  const invoice = await paidRenewalInvoice(input.invoiceId);
  if (invoice.serviceWorkOrderRef) {
    const workOrder = await WorkOrder.findById(invoice.serviceWorkOrderRef)
      .select("date scheduledStart deletedAt")
      .lean();
    if (
      workOrder &&
      !workOrder.deletedAt &&
      isRenewalVisitScheduled({
        date: workOrder.date,
        scheduledStart: workOrder.scheduledStart,
      })
    ) {
      throw new RenewalWorkOrderError("This renewal is already scheduled");
    }
  }
  const actorId =
    input.actor?.actorUserId && Types.ObjectId.isValid(input.actor.actorUserId)
      ? new Types.ObjectId(input.actor.actorUserId)
      : null;
  await Invoice.updateOne(
    { _id: invoice._id },
    {
      $set: {
        renewalWorkOrderDismissedAt: new Date(),
        renewalWorkOrderDismissedBy: actorId,
      },
    },
  );
}
