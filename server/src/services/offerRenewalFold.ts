import { Types } from "mongoose";
import { Contract, type IContract } from "../models/mongo/Contract";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  addMonths,
  computeRenewalDueDateAfterRenewal,
  parseDateOnly,
  startOfDay,
} from "../utils/contractDates";
import { promoteTemporaryContract } from "../utils/temporaryContractOffer";

/** Stored on a renewal invoice that a paid offer replaced. */
export const OFFER_RENEWAL_VOID_REASON = "superseded_by_paid_offer";

const OPEN_RENEWAL_STATUSES = ["open", "draft", "failed"] as const;

export type FoldOfferResult = {
  folded: boolean;
  promoted: boolean;
  contractId: string | null;
  voidedInvoiceNumbers: string[];
  deletedOfferContractId: string | null;
  /** False when the older contract's due date already covers this payment. */
  extendedRenewal: boolean;
  renewalDueDate: string | null;
};

const EMPTY_RESULT: FoldOfferResult = {
  folded: false,
  promoted: false,
  contractId: null,
  voidedInvoiceNumbers: [],
  deletedOfferContractId: null,
  extendedRenewal: false,
  renewalDueDate: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** A due date this close to a year after payment already includes that year. */
const COVERED_GRACE_DAYS = 31;

/**
 * One payment adds one year. If the contract is already due about a year after
 * the payment, keep that date instead of adding a second year.
 */
export function foldedRenewalDueDate(
  currentDue: Date,
  paidAt: Date,
  durationMonths: number,
): { dueDate: Date; extended: boolean } {
  const paidDay = parseDateOnly(paidAt) ?? startOfDay(paidAt);
  const dueDay = parseDateOnly(currentDue) ?? startOfDay(currentDue);
  const oneYearOut = addMonths(paidDay, durationMonths);
  const alreadyCovered =
    dueDay.getTime() > paidDay.getTime() &&
    dueDay.getTime() + COVERED_GRACE_DAYS * DAY_MS >= oneYearOut.getTime();
  if (alreadyCovered) return { dueDate: dueDay, extended: false };
  const { newDueDate } = computeRenewalDueDateAfterRenewal(
    paidDay,
    dueDay,
    durationMonths,
  );
  return { dueDate: newDueDate, extended: true };
}

function invoiceMetadata(invoice: IInvoice): Record<string, unknown> {
  return invoice.metadata && typeof invoice.metadata === "object"
    ? { ...invoice.metadata }
    : {};
}

function wasTemporaryOffer(invoice: IInvoice, offer: IContract): boolean {
  return offer.temporary === true || invoice.metadata?.temporaryContract === true;
}

function durationMonthsOf(invoice: IInvoice, contract: IContract): number {
  const fromInvoice = invoice.metadata?.durationMonths;
  if (typeof fromInvoice === "number" && fromInvoice > 0) return fromInvoice;
  return contract.durationMonths || 12;
}

/**
 * Prefer the contract that still has an unpaid renewal, then the one due latest.
 */
async function pickFoldTarget(contracts: IContract[]): Promise<IContract> {
  const open = await Invoice.findOne({
    contractRef: { $in: contracts.map((contract) => contract._id) },
    sourceType: "contract_renewal",
    status: { $in: OPEN_RENEWAL_STATUSES },
  }).sort({ issuedAt: -1, createdAt: -1 });
  if (open?.contractRef) {
    const match = contracts.find(
      (contract) => String(contract._id) === String(open.contractRef),
    );
    if (match) return match;
  }
  return [...contracts].sort((left, right) => {
    const due =
      (right.renewalDueDate?.getTime() ?? 0) - (left.renewalDueDate?.getTime() ?? 0);
    if (due !== 0) return due;
    return (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0);
  })[0];
}

async function earlierContracts(
  invoice: IInvoice,
  offer: IContract,
): Promise<IContract[]> {
  const templateId = offer.templateId ?? invoice.templateRef ?? null;
  if (!templateId) return [];
  const customerId = invoice.customerId || offer.customerId;
  const candidates = await Contract.find({
    _id: { $ne: offer._id },
    templateId,
    temporary: { $ne: true },
    $or: [
      ...(invoice.customerRef ? [{ customerRef: invoice.customerRef }] : []),
      { customerId },
    ],
  });
  const offerCreated = offer.createdAt?.getTime() ?? Date.now();
  const earlier = candidates.filter(
    (contract) => (contract.createdAt?.getTime() ?? 0) < offerCreated,
  );
  if (earlier.length > 0) return earlier;
  return offer.temporary ? candidates : [];
}

async function promoteOffer(
  offer: IContract,
  invoice: IInvoice,
  dryRun: boolean,
): Promise<FoldOfferResult> {
  if (!dryRun) {
    promoteTemporaryContract(offer, invoice.paidAt ?? new Date());
    await offer.save();
  }
  return {
    folded: false,
    promoted: true,
    contractId: String(offer._id),
    voidedInvoiceNumbers: [],
    deletedOfferContractId: null,
    extendedRenewal: false,
    renewalDueDate: null,
  };
}

/**
 * A paid new-contract offer from a customer who already has that plan is a renewal
 * of the older contract. Customers with no older contract keep the offer, which
 * becomes a normal contract.
 */
export async function foldOfferIntoExistingContract(
  invoice: IInvoice,
  options?: { dryRun?: boolean },
): Promise<FoldOfferResult> {
  if (invoice.sourceType !== "contract_initial" || !invoice.contractRef) {
    return { ...EMPTY_RESULT };
  }
  const offer = await Contract.findById(invoice.contractRef);
  if (!offer || !wasTemporaryOffer(invoice, offer)) return { ...EMPTY_RESULT };

  const targets = await earlierContracts(invoice, offer);
  if (targets.length === 0) {
    if (!offer.temporary) return { ...EMPTY_RESULT };
    return promoteOffer(offer, invoice, Boolean(options?.dryRun));
  }

  const target = await pickFoldTarget(targets);
  const openRenewals = await Invoice.find({
    _id: { $ne: invoice._id },
    contractRef: target._id,
    sourceType: "contract_renewal",
    status: { $in: OPEN_RENEWAL_STATUSES },
  });
  const voidedInvoiceNumbers = openRenewals.map((row) => row.number);
  const dryRun = Boolean(options?.dryRun);
  if (!target.renewalDueDate) {
    console.warn(
      `[offer-renewal] Contract ${String(target._id)} has no renewal due date; invoice ${invoice.number} stays on its offer contract`,
    );
    if (!offer.temporary) return { ...EMPTY_RESULT };
    return promoteOffer(offer, invoice, dryRun);
  }
  const durationMonths = durationMonthsOf(invoice, target);
  const due = foldedRenewalDueDate(
    target.renewalDueDate,
    invoice.paidAt ?? new Date(),
    durationMonths,
  );

  if (dryRun) {
    const [otherInvoices, jobs] = await Promise.all([
      Invoice.countDocuments({
        contractRef: offer._id,
        _id: { $ne: invoice._id },
      }),
      WorkOrder.countDocuments({ contractRef: offer._id, deletedAt: null }),
    ]);
    return {
      folded: true,
      promoted: false,
      contractId: String(target._id),
      voidedInvoiceNumbers,
      deletedOfferContractId:
        otherInvoices === 0 && jobs === 0 ? String(offer._id) : null,
      extendedRenewal: due.extended,
      renewalDueDate: due.dueDate.toISOString(),
    };
  }

  const already = target.renewals.some(
    (renewal) =>
      renewal.invoiceRef && String(renewal.invoiceRef) === String(invoice._id),
  );
  if (!already && due.extended) {
    const { applyContractRenewal, DeletedCustomerRenewalError } = await import(
      "./invoice.service"
    );
    try {
      await applyContractRenewal({
        contract: target,
        renewedAt: invoice.paidAt ?? new Date(),
        durationMonths,
        notes: `Paid via invoice ${invoice.number}`,
        invoiceRef: invoice._id as Types.ObjectId,
        amountCents: invoice.amountCents,
        paymentProvider: invoice.paymentProvider,
        providerPaymentId: invoice.providerPaymentId,
      });
    } catch (err) {
      if (!(err instanceof DeletedCustomerRenewalError)) throw err;
      return { ...EMPTY_RESULT };
    }
  }

  for (const open of openRenewals) {
    open.status = "void";
    open.metadata = {
      ...invoiceMetadata(open),
      voidReason: OFFER_RENEWAL_VOID_REASON,
      supersededByInvoiceNumber: invoice.number,
    };
    open.markModified("metadata");
    await open.save();
  }

  invoice.contractRef = target._id as Types.ObjectId;
  invoice.sourceType = "contract_renewal";
  invoice.metadata = {
    ...invoiceMetadata(invoice),
    foldedFromContractRef: String(offer._id),
  };
  invoice.markModified("metadata");
  await invoice.save();

  await WorkOrder.updateMany(
    { contractRef: offer._id },
    { $set: { contractRef: target._id } },
  );

  const [otherInvoices, jobs] = await Promise.all([
    Invoice.countDocuments({
      contractRef: offer._id,
      _id: { $ne: invoice._id },
    }),
    WorkOrder.countDocuments({ contractRef: offer._id, deletedAt: null }),
  ]);
  let deletedOfferContractId: string | null = null;
  if (otherInvoices === 0 && jobs === 0) {
    await Contract.deleteOne({ _id: offer._id });
    deletedOfferContractId = String(offer._id);
  }

  return {
    folded: true,
    promoted: false,
    contractId: String(target._id),
    voidedInvoiceNumbers,
    deletedOfferContractId,
    extendedRenewal: due.extended,
    renewalDueDate: due.dueDate.toISOString(),
  };
}
