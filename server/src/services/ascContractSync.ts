/**
 * Reconcile each customer's Annual Service Contract dates from the latest
 * work order and/or invoice that includes the ASC product.
 */
import { Model, Types } from "mongoose";
import { IContract } from "../models/mongo/Contract";
import { IContractTemplate } from "../models/mongo/ContractTemplate";
import { ICustomer } from "../models/mongo/Customer";
import { IInvoice } from "../models/mongo/Invoice";
import { IProduct } from "../models/mongo/Product";
import { IWorkOrder } from "../models/mongo/WorkOrder";
import {
  invoiceContainsAscProduct,
  isAscProductCode,
  textMentionsAscProduct,
  workOrderContainsAscProduct,
} from "../utils/ascProduct";
import {
  DEFAULT_DURATION_MONTHS,
  computeInitialRenewalDueDate,
  getContractStanding,
  parseDateOnly,
} from "../utils/contractDates";
import { inferContractType } from "../utils/contractTypes";

export type AscSyncModels = {
  Customer: Model<ICustomer>;
  WorkOrder: Model<IWorkOrder>;
  Invoice: Model<IInvoice>;
  Product: Model<IProduct>;
  Contract: Model<IContract>;
  ContractTemplate: Model<IContractTemplate>;
};

export type AscOccurrenceKind = "work_order" | "invoice";

export type AscOccurrence = {
  date: Date | null | undefined;
  kind: AscOccurrenceKind;
  id?: string;
  legacyId?: number;
  customerId?: number;
  customerRef?: string;
  addressRef?: string | null;
  equipmentRef?: string | null;
  description?: string;
  userId?: number;
};

export type ExistingAscContract = {
  originalContractDate?: Date | null;
  contractDate?: Date | null;
  lastRenewalDate?: Date | null;
  renewalDueDate?: Date | null;
  durationMonths?: number | null;
  sourceWorkOrderRef?: { toString(): string } | string | null;
};

export type DerivedAscContractDates = {
  originalContractDate: Date;
  contractDate: Date;
  lastRenewalDate: Date;
  renewalDueDate: Date;
  durationMonths: number;
  changed: boolean;
};

export type AscContractSyncSummary = {
  customersWithAsc: number;
  contractsCreated: number;
  contractsUpdated: number;
  skippedNoCustomer: number;
  skippedNoDate: number;
};

const SERVICE_TEMPLATE = {
  slug: "service",
  label: "Service Contract",
  body: "",
  cost: 0,
  badgeIcon: "scroll-text",
};

const IGNORED_INVOICE_STATUSES = ["void", "failed"];

function dateKey(value: Date | null | undefined): string {
  const parsed = parseDateOnly(value);
  if (!parsed) return "";
  return parsed.toISOString().slice(0, 10);
}

export function pickLatestAscOccurrence(
  items: AscOccurrence[],
): AscOccurrence | null {
  const dated = items
    .map((item) => ({ item, parsed: parseDateOnly(item.date) }))
    .filter((row): row is { item: AscOccurrence; parsed: Date } =>
      Boolean(row.parsed),
    );
  if (dated.length === 0) return null;

  dated.sort((a, b) => {
    const byDate = b.parsed.getTime() - a.parsed.getTime();
    if (byDate !== 0) return byDate;
    if (a.item.kind !== b.item.kind) {
      return a.item.kind === "work_order" ? -1 : 1;
    }
    return (b.item.legacyId ?? 0) - (a.item.legacyId ?? 0);
  });
  return dated[0].item;
}

export function deriveAscContractDates(
  existing: ExistingAscContract | null,
  latestAscDate: Date,
  durationMonths = DEFAULT_DURATION_MONTHS,
): DerivedAscContractDates | null {
  const sourceDate = parseDateOnly(latestAscDate);
  if (!sourceDate) return null;

  const months =
    existing?.durationMonths && existing.durationMonths >= 1
      ? existing.durationMonths
      : durationMonths;

  const existingOriginal = parseDateOnly(existing?.originalContractDate);
  const originalContractDate =
    existingOriginal && existingOriginal.getTime() <= sourceDate.getTime()
      ? existingOriginal
      : sourceDate;

  const existingContract = parseDateOnly(existing?.contractDate);
  const contractDate = existingContract ?? sourceDate;
  const lastRenewalDate = sourceDate;
  const renewalDueDate = computeInitialRenewalDueDate(sourceDate, months);
  if (!renewalDueDate) return null;

  const changed =
    !existing ||
    dateKey(existing.originalContractDate) !== dateKey(originalContractDate) ||
    dateKey(existing.contractDate) !== dateKey(contractDate) ||
    dateKey(existing.lastRenewalDate) !== dateKey(lastRenewalDate) ||
    dateKey(existing.renewalDueDate) !== dateKey(renewalDueDate);

  return {
    originalContractDate,
    contractDate,
    lastRenewalDate,
    renewalDueDate,
    durationMonths: months,
    changed,
  };
}

export function standingFromLatestAscDate(
  latestAscDate: Date | null | undefined,
  today: Date = new Date(),
  durationMonths = DEFAULT_DURATION_MONTHS,
): ReturnType<typeof getContractStanding> {
  const derived = latestAscDate
    ? deriveAscContractDates(null, latestAscDate, durationMonths)
    : null;
  return getContractStanding(derived?.renewalDueDate ?? null, today);
}

async function loadAscProductIds(models: AscSyncModels): Promise<Set<string>> {
  const products = await models.Product.find({
    $or: [
      { productCode: { $in: [...ASC_CODES] } },
      { partNumber: { $in: [...ASC_CODES] } },
    ],
  })
    .select("_id productCode partNumber")
    .lean();

  const ids = new Set<string>();
  for (const product of products) {
    if (
      isAscProductCode(product.productCode) ||
      isAscProductCode(product.partNumber)
    ) {
      ids.add(String(product._id));
    }
  }
  return ids;
}

const ASC_CODES = ["ASC", "ACS"];

function refString(
  value: { toString(): string } | string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  const text = String(value);
  return text || undefined;
}

function isServiceContract(
  contract: {
    contractType?: string | null;
    description?: string | null;
    templateId?: { toString(): string } | string | null;
  },
  serviceTemplateId?: string,
): boolean {
  if (contract.contractType === "service") return true;
  if (
    serviceTemplateId &&
    contract.templateId &&
    String(contract.templateId) === serviceTemplateId
  ) {
    return true;
  }
  return inferContractType(contract.description ?? "") === "service";
}

function pickContractForSource<
  T extends {
    addressRef?: { toString(): string } | string | null;
    equipmentRef?: { toString(): string } | string | null;
    contractDate?: Date | null;
    renewalDueDate?: Date | null;
  },
>(contracts: T[], source: AscOccurrence): T | null {
  if (contracts.length === 0) return null;

  if (source.equipmentRef) {
    const match = contracts.find(
      (contract) =>
        contract.equipmentRef &&
        String(contract.equipmentRef) === source.equipmentRef,
    );
    if (match) return match;
  }
  if (source.addressRef) {
    const match = contracts.find(
      (contract) =>
        contract.addressRef && String(contract.addressRef) === source.addressRef,
    );
    if (match) return match;
  }

  const unscoped = contracts.filter(
    (contract) => !contract.addressRef && !contract.equipmentRef,
  );
  const pool = unscoped.length > 0 ? unscoped : contracts;
  return (
    [...pool].sort((a, b) => {
      const aTime = (a.renewalDueDate ?? a.contractDate)?.getTime() ?? 0;
      const bTime = (b.renewalDueDate ?? b.contractDate)?.getTime() ?? 0;
      return bTime - aTime;
    })[0] ?? null
  );
}

async function ensureServiceTemplate(
  models: AscSyncModels,
): Promise<{ _id: Types.ObjectId }> {
  const existing = await models.ContractTemplate.findOne({
    slug: SERVICE_TEMPLATE.slug,
  });
  if (existing) {
    if (existing.deletedAt) {
      existing.deletedAt = null;
      await existing.save();
    }
    return { _id: existing._id as Types.ObjectId };
  }
  const created = await models.ContractTemplate.create({
    ...SERVICE_TEMPLATE,
    deletedAt: null,
  });
  return { _id: created._id as Types.ObjectId };
}

export async function syncAscContractsFromRecords(
  models: AscSyncModels,
  options?: {
    dryRun?: boolean;
    onLog?: (message: string) => void;
  },
): Promise<AscContractSyncSummary> {
  const dryRun = options?.dryRun ?? false;
  const log = options?.onLog ?? (() => undefined);

  const summary: AscContractSyncSummary = {
    customersWithAsc: 0,
    contractsCreated: 0,
    contractsUpdated: 0,
    skippedNoCustomer: 0,
    skippedNoDate: 0,
  };

  const ascProductIds = await loadAscProductIds(models);
  const productRefFilter =
    ascProductIds.size > 0
      ? [{ "parts.productRef": { $in: [...ascProductIds] } }]
      : [];

  const workOrders = await models.WorkOrder.find({
    $or: [
      { "parts.partNumber": { $in: ASC_CODES } },
      { "parts.productCode": { $in: ASC_CODES } },
      ...productRefFilter,
      { "parts.description": { $regex: /\b(?:asc|acs|annual\s+service(?:\s+contract)?)\b/i } },
      { descPerform: { $regex: /\b(?:asc|acs|annual\s+service(?:\s+contract)?)\b/i } },
      { descPerformed: { $regex: /\b(?:asc|acs|annual\s+service(?:\s+contract)?)\b/i } },
    ],
  })
    .select(
      "_id legacyId customerId customerRef addressRef equipmentRef date descPerform descPerformed userId parts",
    )
    .lean();

  const invoices = await models.Invoice.find({
    status: { $nin: IGNORED_INVOICE_STATUSES },
    $or: [
      {
        "lineItems.description": {
          $regex: /\b(?:asc|acs|annual\s+service(?:\s+contract)?)\b/i,
        },
      },
      { "lineItems.productCode": { $in: ASC_CODES } },
    ],
  })
    .select(
      "_id number customerId customerRef issuedAt paidAt status lineItems workOrderRef",
    )
    .lean();

  const customers = await models.Customer.find()
    .select("_id legacyId")
    .lean();
  const customerById = new Map(customers.map((c) => [String(c._id), c]));
  const customerByLegacy = new Map(
    customers.map((c) => [c.legacyId, c] as const),
  );

  const byCustomer = new Map<string, AscOccurrence[]>();

  function resolveCustomerKey(
    customerRef: unknown,
    customerId: number | undefined,
  ): { key: string; customerId: number; customerRef: string } | null {
    const ref = refString(customerRef as { toString(): string } | undefined);
    if (ref && customerById.has(ref)) {
      const customer = customerById.get(ref)!;
      return {
        key: ref,
        customerId: customer.legacyId,
        customerRef: ref,
      };
    }
    if (customerId != null && customerByLegacy.has(customerId)) {
      const customer = customerByLegacy.get(customerId)!;
      const id = String(customer._id);
      return { key: id, customerId: customer.legacyId, customerRef: id };
    }
    return null;
  }

  function addOccurrence(
    resolved: { key: string; customerId: number; customerRef: string } | null,
    occurrence: AscOccurrence,
  ): void {
    if (!resolved) {
      summary.skippedNoCustomer += 1;
      return;
    }
    if (!parseDateOnly(occurrence.date)) {
      summary.skippedNoDate += 1;
      return;
    }
    const list = byCustomer.get(resolved.key) ?? [];
    list.push({
      ...occurrence,
      customerId: resolved.customerId,
      customerRef: resolved.customerRef,
    });
    byCustomer.set(resolved.key, list);
  }

  for (const wo of workOrders) {
    if (!workOrderContainsAscProduct(wo, ascProductIds)) continue;
    addOccurrence(resolveCustomerKey(wo.customerRef, wo.customerId), {
      date: wo.date,
      kind: "work_order",
      id: String(wo._id),
      legacyId: wo.legacyId,
      addressRef: refString(wo.addressRef) ?? null,
      equipmentRef: refString(wo.equipmentRef) ?? null,
      description: wo.descPerform || wo.descPerformed || "Annual Service Contract",
      userId: wo.userId,
    });
  }

  for (const invoice of invoices) {
    if (!invoiceContainsAscProduct(invoice)) continue;
    const invoiceDate = invoice.paidAt ?? invoice.issuedAt;
    addOccurrence(
      resolveCustomerKey(invoice.customerRef, invoice.customerId),
      {
        date: invoiceDate,
        kind: "invoice",
        id: String(invoice._id),
        description:
          invoice.lineItems?.find((item) =>
            textMentionsAscProduct(item.description),
          )?.description ||
          invoice.number ||
          "Annual Service Contract",
      },
    );
  }

  summary.customersWithAsc = byCustomer.size;
  if (byCustomer.size === 0) {
    log("No work orders or invoices with the ASC product were found.");
    return summary;
  }

  const latestByCustomer = new Map<string, AscOccurrence>();
  for (const [key, items] of byCustomer) {
    const latest = pickLatestAscOccurrence(items);
    if (latest) latestByCustomer.set(key, latest);
  }

  const customerIds = [...latestByCustomer.keys()];
  const existingContracts = await models.Contract.find({
    $or: [
      { customerRef: { $in: customerIds } },
      {
        customerId: {
          $in: [...latestByCustomer.values()].map((item) => item.customerId),
        },
      },
    ],
  }).lean();

  const serviceTemplate = dryRun
    ? await models.ContractTemplate.findOne({ slug: SERVICE_TEMPLATE.slug })
        .select("_id")
        .lean()
    : await ensureServiceTemplate(models);
  const serviceTemplateId = serviceTemplate
    ? String(serviceTemplate._id)
    : undefined;

  const contractsByCustomer = new Map<string, typeof existingContracts>();
  for (const contract of existingContracts) {
    if (!isServiceContract(contract, serviceTemplateId)) continue;
    const key =
      refString(contract.customerRef) ||
      (customerByLegacy.has(contract.customerId)
        ? String(customerByLegacy.get(contract.customerId)!._id)
        : "");
    if (!key) continue;
    const list = contractsByCustomer.get(key) ?? [];
    list.push(contract);
    contractsByCustomer.set(key, list);
  }

  for (const [key, source] of latestByCustomer) {
    const sourceDate = parseDateOnly(source.date);
    if (!sourceDate || source.customerId == null || !source.customerRef) {
      continue;
    }

    const existing = pickContractForSource(
      contractsByCustomer.get(key) ?? [],
      source,
    );
    const derived = deriveAscContractDates(existing, sourceDate);
    if (!derived) continue;

    const workOrderRef =
      source.kind === "work_order" && source.id
        ? new Types.ObjectId(source.id)
        : existing?.sourceWorkOrderRef
          ? new Types.ObjectId(String(existing.sourceWorkOrderRef))
          : undefined;

    if (existing) {
      if (!derived.changed) continue;
      summary.contractsUpdated += 1;
      if (dryRun) continue;
      await models.Contract.updateOne(
        { _id: existing._id },
        {
          $set: {
            originalContractDate: derived.originalContractDate,
            contractDate: derived.contractDate,
            lastRenewalDate: derived.lastRenewalDate,
            renewalDueDate: derived.renewalDueDate,
            durationMonths: derived.durationMonths,
            contractType: existing.contractType || "service",
            templateId: existing.templateId ?? serviceTemplate?._id ?? null,
            ...(workOrderRef ? { sourceWorkOrderRef: workOrderRef } : {}),
            customerRef: existing.customerRef ?? source.customerRef,
          },
        },
      );
      continue;
    }

    summary.contractsCreated += 1;
    if (dryRun) continue;

    await models.Contract.create({
      customerId: source.customerId,
      customerRef: source.customerRef,
      addressRef: source.addressRef ?? null,
      equipmentRef: source.equipmentRef ?? null,
      templateId: serviceTemplate?._id ?? null,
      originalContractDate: derived.originalContractDate,
      contractDate: derived.contractDate,
      durationMonths: derived.durationMonths,
      renewalDueDate: derived.renewalDueDate,
      lastRenewalDate: derived.lastRenewalDate,
      renewals: [],
      description: source.description || "Annual Service Contract",
      contractType: "service",
      sourceWorkOrderRef: workOrderRef ?? undefined,
      userId: source.userId,
    });
  }

  log(
    dryRun
      ? `ASC contracts: would create ${summary.contractsCreated.toLocaleString()} and update ${summary.contractsUpdated.toLocaleString()} (${summary.customersWithAsc.toLocaleString()} customers with ASC).`
      : `ASC contracts: created ${summary.contractsCreated.toLocaleString()} and updated ${summary.contractsUpdated.toLocaleString()} (${summary.customersWithAsc.toLocaleString()} customers with ASC).`,
  );

  return summary;
}
