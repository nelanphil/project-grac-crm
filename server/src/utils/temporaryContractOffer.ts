import {
  computeInitialRenewalDueDate,
  DEFAULT_DURATION_MONTHS,
  parseDateOnly,
  startOfDay,
} from "./contractDates";

export const TEMPORARY_CONTRACT_DURATION_MONTHS = DEFAULT_DURATION_MONTHS;

/** Customer-facing contract queries omit unpaid email offers. */
export function visibleContractQuery<T extends Record<string, unknown>>(
  filter: T = {} as T,
): T & { temporary: { $ne: true } } {
  return { ...filter, temporary: { $ne: true } };
}

export function offerTemplateError(
  template: { cost: number; deletedAt?: Date | null } | null | undefined,
): string | null {
  if (!template || template.deletedAt) {
    return "Contract template is not available";
  }
  if (!(template.cost > 0)) {
    return "Contract template must have a cost greater than zero";
  }
  return null;
}

export type OfferInvoiceLike = {
  status: string;
  sourceType: string;
};

/** Open initial invoice already created for a temporary contract. */
export function reusableOfferInvoice<T extends OfferInvoiceLike>(
  invoices: T[],
): T | null {
  return (
    invoices.find(
      (invoice) =>
        invoice.sourceType === "contract_initial" &&
        (invoice.status === "open" || invoice.status === "draft"),
    ) ?? null
  );
}

export type TemporaryContractDates = {
  temporary?: boolean;
  durationMonths?: number;
  originalContractDate: Date | null;
  contractDate: Date | null;
  renewalDueDate: Date | null;
};

/** Turn a paid email offer into a normal contract starting on the payment date. */
export function promoteTemporaryContract(
  contract: TemporaryContractDates,
  paidAt: Date,
): void {
  if (!contract.temporary) return;
  const durationMonths =
    contract.durationMonths || TEMPORARY_CONTRACT_DURATION_MONTHS;
  const contractDate = parseDateOnly(paidAt) ?? startOfDay(paidAt);
  contract.temporary = false;
  if (!contract.originalContractDate) {
    contract.originalContractDate = contractDate;
  }
  contract.contractDate = contractDate;
  contract.renewalDueDate = computeInitialRenewalDueDate(
    contractDate,
    durationMonths,
  );
}

export type OfferContractOverride = {
  contactId: string;
  contractTemplateId: string | null;
};

/** Per-recipient override wins. Null means do not offer a contract. */
export function resolveOfferContractTemplateId(
  contactId: string,
  campaignDefault: string | null | undefined,
  overrides: OfferContractOverride[] | null | undefined,
): string | null {
  const override = overrides?.find((row) => row.contactId === contactId);
  if (override) return override.contractTemplateId;
  const id = campaignDefault?.trim() ?? "";
  return id || null;
}
