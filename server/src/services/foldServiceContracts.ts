import { Types } from "mongoose";
import { Contract, type IContract, type IRenewalEvent } from "../models/mongo/Contract";
import { Invoice } from "../models/mongo/Invoice";
import { WorkOrder } from "../models/mongo/WorkOrder";
import { inferContractType } from "../utils/contractTypes";
import { parseDateOnly } from "../utils/contractDates";
import { OPEN_PAYABLE_INVOICE_STATUSES } from "../utils/standingContract";
import { SUPERSEDED_BY_PAYMENT } from "./contractInvoiceSiblings";

export type FoldServiceContractsResult = {
  keptId: string | null;
  foldedIds: string[];
};

function isServiceContract(contract: {
  contractType?: string | null;
  description?: string | null;
}): boolean {
  if (contract.contractType === "service") return true;
  return inferContractType(contract.description ?? "") === "service";
}

export function pickKeptServiceContract(contracts: IContract[]): IContract {
  return [...contracts].sort((left, right) => {
    const due =
      (right.renewalDueDate?.getTime() ?? 0) -
      (left.renewalDueDate?.getTime() ?? 0);
    if (due !== 0) return due;
    const last =
      (right.lastRenewalDate?.getTime() ?? 0) -
      (left.lastRenewalDate?.getTime() ?? 0);
    if (last !== 0) return last;
    return (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0);
  })[0];
}

function laterDate(left: Date | null | undefined, right: Date | null | undefined): Date | null {
  const a = parseDateOnly(left);
  const b = parseDateOnly(right);
  if (!a) return b;
  if (!b) return a;
  return a.getTime() >= b.getTime() ? a : b;
}

function earlierDate(left: Date | null | undefined, right: Date | null | undefined): Date | null {
  const a = parseDateOnly(left);
  const b = parseDateOnly(right);
  if (!a) return b;
  if (!b) return a;
  return a.getTime() <= b.getTime() ? a : b;
}

function mergeRenewalHistory(kept: IContract, extra: IContract): IRenewalEvent[] {
  const merged = [...(kept.renewals ?? [])];
  const seen = new Set(
    merged
      .map((renewal) =>
        renewal.invoiceRef ? `inv:${String(renewal.invoiceRef)}` : "",
      )
      .filter(Boolean),
  );
  for (const renewal of extra.renewals ?? []) {
    const key = renewal.invoiceRef ? `inv:${String(renewal.invoiceRef)}` : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(renewal);
  }
  return merged.sort(
    (left, right) =>
      (left.renewedAt?.getTime() ?? 0) - (right.renewedAt?.getTime() ?? 0),
  );
}

/**
 * After a customer merge, keep one live service contract and fold the rest
 * into it. Invoices and work orders move to the kept row.
 */
export async function foldDuplicateServiceContracts(opts: {
  customerRef: Types.ObjectId | string;
  dryRun?: boolean;
}): Promise<FoldServiceContractsResult> {
  const contracts = (
    await Contract.find({
      customerRef: opts.customerRef,
      temporary: { $ne: true },
    })
  ).filter((contract) => isServiceContract(contract));

  if (contracts.length < 2) {
    return { keptId: contracts[0] ? String(contracts[0]._id) : null, foldedIds: [] };
  }

  const kept = pickKeptServiceContract(contracts);
  const extras = contracts.filter(
    (contract) => String(contract._id) !== String(kept._id),
  );
  const foldedIds = extras.map((contract) => String(contract._id));
  if (opts.dryRun) {
    return { keptId: String(kept._id), foldedIds };
  }

  for (const extra of extras) {
    kept.originalContractDate = earlierDate(
      kept.originalContractDate,
      extra.originalContractDate,
    );
    kept.contractDate = earlierDate(kept.contractDate, extra.contractDate);
    kept.lastRenewalDate = laterDate(kept.lastRenewalDate, extra.lastRenewalDate);
    kept.renewalDueDate = laterDate(kept.renewalDueDate, extra.renewalDueDate);
    kept.renewals = mergeRenewalHistory(kept, extra);
    if (!kept.templateId && extra.templateId) kept.templateId = extra.templateId;
    if (!kept.contractType && extra.contractType) {
      kept.contractType = extra.contractType;
    }

    const extraOpen = await Invoice.find({
      contractRef: extra._id,
      sourceType: { $in: ["contract_renewal", "contract_initial"] },
      status: { $in: [...OPEN_PAYABLE_INVOICE_STATUSES] },
    });
    for (const invoice of extraOpen) {
      invoice.status = "void";
      invoice.metadata = {
        ...(invoice.metadata && typeof invoice.metadata === "object"
          ? invoice.metadata
          : {}),
        voidReason: SUPERSEDED_BY_PAYMENT,
      };
      invoice.markModified("metadata");
      await invoice.save();
    }

    await Invoice.updateMany(
      { contractRef: extra._id },
      { $set: { contractRef: kept._id } },
    );
    await WorkOrder.updateMany(
      { contractRef: extra._id },
      { $set: { contractRef: kept._id } },
    );

    extra.deletedAt = new Date();
    extra.deletedBy = "fold-service-contracts";
    await extra.save();
  }

  kept.markModified("renewals");
  await kept.save();
  return { keptId: String(kept._id), foldedIds };
}
