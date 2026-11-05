import { Types } from "mongoose";

export const OPEN_PAYABLE_INVOICE_STATUSES = ["open", "draft", "failed"] as const;

export function isDuplicateKeyError(err: unknown): boolean {
  return (
    Boolean(err) &&
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

export function customerIdentityFilter(
  customerRef?: Types.ObjectId | string | null,
  customerId?: number | null,
): Record<string, unknown> | null {
  const or: Record<string, unknown>[] = [];
  if (customerRef) or.push({ customerRef });
  if (customerId != null) or.push({ customerId });
  if (or.length === 0) return null;
  return or.length === 1 ? or[0] : { $or: or };
}

export function contractPlanFilter(
  templateId?: Types.ObjectId | string | null,
  contractType?: string | null,
): Record<string, unknown> | null {
  const or: Record<string, unknown>[] = [];
  if (templateId) or.push({ templateId });
  if (contractType) or.push({ contractType });
  if (or.length === 0) return null;
  return or.length === 1 ? or[0] : { $or: or };
}

/** Live (non-offer) contracts for this customer and plan. */
export function standingContractQuery(opts: {
  customerRef?: Types.ObjectId | string | null;
  customerId?: number | null;
  templateId?: Types.ObjectId | string | null;
  contractType?: string | null;
}): Record<string, unknown> | null {
  const identity = customerIdentityFilter(opts.customerRef, opts.customerId);
  const plan = contractPlanFilter(opts.templateId, opts.contractType);
  if (!identity || !plan) return null;
  return {
    temporary: { $ne: true },
    $and: [identity, plan],
  };
}

export function pickLatestStandingContract<
  T extends { renewalDueDate?: Date | null; createdAt?: Date | null },
>(contracts: T[]): T | null {
  if (contracts.length === 0) return null;
  return [...contracts].sort((left, right) => {
    const due =
      (right.renewalDueDate?.getTime() ?? 0) -
      (left.renewalDueDate?.getTime() ?? 0);
    if (due !== 0) return due;
    return (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0);
  })[0];
}
