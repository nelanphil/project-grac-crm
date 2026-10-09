import { Types } from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import { Customer } from "../models/mongo/Customer";
import { Invoice } from "../models/mongo/Invoice";
import {
  offerTemplateError,
  reusableOfferInvoice,
  TEMPORARY_CONTRACT_DURATION_MONTHS,
} from "../utils/temporaryContractOffer";
import { dollarsToCents, nextInvoiceNumber } from "./invoice.service";

export class TemporaryContractOfferError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TemporaryContractOfferError";
    this.status = status;
  }
}

function isDuplicateKey(err: unknown): boolean {
  return (
    Boolean(err) &&
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

/**
 * Create or reuse a hidden contract and an open initial invoice for the
 * selected catalog contract. The invoice is added to checkout with any unpaid
 * invoices or work orders the customer already has.
 */
export async function ensureTemporaryContractOffer(
  customerId: string,
  contractTemplateId: string,
): Promise<{ contractId: string; invoiceId: string; created: boolean }> {
  if (
    !Types.ObjectId.isValid(customerId) ||
    !Types.ObjectId.isValid(contractTemplateId)
  ) {
    throw new TemporaryContractOfferError(
      "Invalid customer or contract template",
    );
  }

  const template = await ContractTemplate.findById(contractTemplateId).lean();
  const reason = offerTemplateError(template);
  if (reason || !template) {
    throw new TemporaryContractOfferError(
      reason ?? "Contract template is not available",
    );
  }

  const customer = await Customer.findById(customerId).select("_id legacyId");
  if (!customer || typeof customer.legacyId !== "number") {
    throw new TemporaryContractOfferError("Customer not found", 404);
  }

  const offerFilter = {
    customerRef: customer._id,
    templateId: template._id,
    temporary: true,
  };

  let contract = await Contract.findOne(offerFilter);
  if (!contract) {
    try {
      contract = await Contract.create({
        customerId: customer.legacyId,
        customerRef: customer._id,
        addressRef: null,
        equipmentRef: null,
        templateId: template._id,
        originalContractDate: null,
        contractDate: null,
        durationMonths: TEMPORARY_CONTRACT_DURATION_MONTHS,
        renewalDueDate: null,
        lastRenewalDate: null,
        renewals: [],
        description: template.label,
        contractType: template.slug,
        temporary: true,
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      contract = await Contract.findOne(offerFilter);
      if (!contract) throw err;
    }
  }

  const existingInvoices = await Invoice.find({
    contractRef: contract._id,
    sourceType: "contract_initial",
  }).select("status sourceType");
  const open = reusableOfferInvoice(existingInvoices);
  if (open) {
    return {
      contractId: String(contract._id),
      invoiceId: String(open._id),
      created: false,
    };
  }

  const amountCents = dollarsToCents(template.cost);
  if (amountCents <= 0) {
    throw new TemporaryContractOfferError(
      "Contract template must have a cost greater than zero",
    );
  }

  const issuedAt = new Date();
  const invoice = await Invoice.create({
    number: await nextInvoiceNumber(issuedAt),
    customerId: customer.legacyId,
    customerRef: customer._id,
    sourceType: "contract_initial",
    contractRef: contract._id,
    templateRef: template._id,
    lineItems: [
      {
        description: `Contract: ${template.label}`,
        amountCents,
      },
    ],
    amountCents,
    currency: "USD",
    status: "open",
    issuedAt,
    metadata: {
      durationMonths: contract.durationMonths,
      templateLabel: template.label,
      temporaryContract: true,
    },
  });

  return {
    contractId: String(contract._id),
    invoiceId: String(invoice._id),
    created: true,
  };
}
