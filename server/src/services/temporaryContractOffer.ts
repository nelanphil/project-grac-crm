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
import {
  contractChargeFromPreTaxCents,
  ensureContractInvoiceIncludesTax,
  getTaxRatePercent,
} from "./taxSettings";

export class TemporaryContractOfferError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "TemporaryContractOfferError";
    this.status = status;
  }
}

const OPEN_RENEWAL_STATUSES = ["open", "draft", "failed"] as const;

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
 * selected catalog contract. When the customer already has that plan and an
 * unpaid renewal, the renewal invoice is returned instead so the link does not
 * start a second contract.
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

  const standing = await Contract.find({
    customerRef: customer._id,
    templateId: template._id,
    temporary: { $ne: true },
  }).select("_id");
  if (standing.length > 0) {
    const openRenewal = await Invoice.findOne({
      contractRef: { $in: standing.map((contract) => contract._id) },
      sourceType: "contract_renewal",
      status: { $in: OPEN_RENEWAL_STATUSES },
    }).sort({ issuedAt: -1, createdAt: -1 });
    if (openRenewal?.contractRef) {
      return {
        contractId: String(openRenewal.contractRef),
        invoiceId: String(openRenewal._id),
        created: false,
      };
    }
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
  });
  const open = reusableOfferInvoice(existingInvoices);
  if (open) {
    await ensureContractInvoiceIncludesTax(open);
    return {
      contractId: String(contract._id),
      invoiceId: String(open._id),
      created: false,
    };
  }

  const preTaxCents = dollarsToCents(template.cost);
  if (preTaxCents <= 0) {
    throw new TemporaryContractOfferError(
      "Contract template must have a cost greater than zero",
    );
  }
  const priced = contractChargeFromPreTaxCents(
    preTaxCents,
    await getTaxRatePercent(),
  );

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
        amountCents: preTaxCents,
      },
    ],
    amountCents: priced.amountCents,
    currency: "USD",
    status: "open",
    issuedAt,
    metadata: {
      durationMonths: contract.durationMonths,
      templateLabel: template.label,
      temporaryContract: true,
    },
    taxRatePercent: priced.taxRatePercent,
    taxCents: priced.taxCents,
    taxOverridden: false,
  });

  return {
    contractId: String(contract._id),
    invoiceId: String(invoice._id),
    created: true,
  };
}
