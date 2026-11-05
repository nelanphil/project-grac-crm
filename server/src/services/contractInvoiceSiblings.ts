import { Types } from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  contractPlanFilter,
  customerIdentityFilter,
  OPEN_PAYABLE_INVOICE_STATUSES,
} from "../utils/standingContract";

export const SUPERSEDED_BY_PAYMENT = "superseded_by_payment";

export type VoidSiblingResult = {
  voidedInvoiceNumbers: string[];
  deletedOfferContractIds: string[];
};

function invoiceMetadata(invoice: IInvoice): Record<string, unknown> {
  return invoice.metadata && typeof invoice.metadata === "object"
    ? { ...invoice.metadata }
    : {};
}

/**
 * After one ASC / contract payment succeeds, close every other payable link
 * for that customer and plan so a second charge cannot go through.
 */
export async function voidSiblingContractInvoices(opts: {
  keepInvoiceId: Types.ObjectId | string;
  customerRef?: Types.ObjectId | string | null;
  customerId?: number | null;
  templateId?: Types.ObjectId | string | null;
  contractType?: string | null;
  paidInvoiceNumber?: string;
  reason?: string;
  dryRun?: boolean;
}): Promise<VoidSiblingResult> {
  const empty: VoidSiblingResult = {
    voidedInvoiceNumbers: [],
    deletedOfferContractIds: [],
  };
  const identity = customerIdentityFilter(opts.customerRef, opts.customerId);
  const plan = contractPlanFilter(opts.templateId, opts.contractType);
  if (!identity || !plan) return empty;

  const contracts = await Contract.find({ $and: [identity, plan] })
    .select("_id temporary")
    .lean();
  if (contracts.length === 0) return empty;

  const siblings = await Invoice.find({
    _id: { $ne: opts.keepInvoiceId },
    contractRef: { $in: contracts.map((contract) => contract._id) },
    sourceType: { $in: ["contract_initial", "contract_renewal"] },
    status: { $in: [...OPEN_PAYABLE_INVOICE_STATUSES] },
  });

  const voidedInvoiceNumbers = siblings.map((invoice) => invoice.number);
  const offerIds = new Set(
    contracts
      .filter((contract) => contract.temporary)
      .map((contract) => String(contract._id)),
  );
  const deletedOfferContractIds: string[] = [];

  if (opts.dryRun) {
    for (const offerId of offerIds) {
      const remaining = await Invoice.countDocuments({
        contractRef: offerId,
        _id: { $nin: [opts.keepInvoiceId, ...siblings.map((row) => row._id)] },
      });
      const jobs = await WorkOrder.countDocuments({
        contractRef: offerId,
        deletedAt: null,
      });
      if (remaining === 0 && jobs === 0) deletedOfferContractIds.push(offerId);
    }
    return { voidedInvoiceNumbers, deletedOfferContractIds };
  }

  const reason = opts.reason ?? SUPERSEDED_BY_PAYMENT;
  for (const invoice of siblings) {
    invoice.status = "void";
    invoice.metadata = {
      ...invoiceMetadata(invoice),
      voidReason: reason,
      ...(opts.paidInvoiceNumber
        ? { supersededByInvoiceNumber: opts.paidInvoiceNumber }
        : {}),
    };
    invoice.markModified("metadata");
    await invoice.save();
  }

  for (const offerId of offerIds) {
    const remaining = await Invoice.countDocuments({
      contractRef: offerId,
      _id: { $ne: opts.keepInvoiceId },
    });
    const jobs = await WorkOrder.countDocuments({
      contractRef: offerId,
      deletedAt: null,
    });
    if (remaining === 0 && jobs === 0) {
      await Contract.deleteOne({ _id: offerId, temporary: true });
      deletedOfferContractIds.push(offerId);
    }
  }

  return { voidedInvoiceNumbers, deletedOfferContractIds };
}
