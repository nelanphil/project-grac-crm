/**
 * Repair duplicate ASC contracts, future-dated windows, and missing
 * renewal history. Dry-run by default. Pass --apply to write.
 *
 *   npx tsx src/scripts/repair-asc-renewals.ts
 *   npx tsx src/scripts/repair-asc-renewals.ts --apply
 *
 * Do not add this to migrations/manifest.ts until a dry-run output
 * has been reviewed.
 */
import dotenv from "dotenv";
import path from "path";

const envCandidates = [
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../../.env"),
];
for (const envPath of envCandidates) {
  dotenv.config({ path: envPath });
}

import mongoose, { Types } from "mongoose";
mongoose.set("autoIndex", false);

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Contract } from "../models/mongo/Contract";
import { Invoice } from "../models/mongo/Invoice";
import { Product } from "../models/mongo/Product";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  ascWorkOrderQuery,
  deriveAscContractDates,
  findAscProductIds,
  latestPaidRenewalDueDate,
} from "../services/ascContractSync";
import { foldDuplicateServiceContracts } from "../services/foldServiceContracts";
import { parseDateOnly, startOfDay } from "../utils/contractDates";
import { OPEN_PAYABLE_INVOICE_STATUSES } from "../utils/standingContract";

const APPLY = process.argv.includes("--apply");
const DRY_RUN = !APPLY;

function log(message: string): void {
  console.log(`[repair-asc-renewals] ${message}`);
}

async function loadAscProductIds(): Promise<Set<string>> {
  return findAscProductIds(Product);
}

async function foldDuplicatePairs(): Promise<void> {
  const groups = await Contract.aggregate([
    {
      $match: {
        deletedAt: null,
        temporary: { $ne: true },
        $or: [
          { contractType: "service" },
          { description: { $regex: /ASC|ACS/i } },
        ],
      },
    },
    { $group: { _id: "$customerRef", n: { $sum: 1 } } },
    { $match: { n: { $gt: 1 }, _id: { $ne: null } } },
  ]);
  log(`pass 1: ${groups.length} customer${groups.length === 1 ? "" : "s"} with duplicate service contracts`);
  for (const group of groups) {
    const result = await foldDuplicateServiceContracts({
      customerRef: group._id,
      dryRun: DRY_RUN,
    });
    log(
      `${DRY_RUN ? "would fold" : "folded"} ${result.foldedIds.join(", ")} into ${result.keptId}`,
    );
  }
}

async function fixFutureDatedContracts(): Promise<void> {
  const today = startOfDay(new Date());
  const contracts = await Contract.find({
    temporary: { $ne: true },
    lastRenewalDate: { $gt: today },
  });
  log(`pass 2: ${contracts.length} contract${contracts.length === 1 ? "" : "s"} with a last renewal in the future`);
  const ascProductIds = await loadAscProductIds();
  const woQuery = {
    ...ascWorkOrderQuery(ascProductIds, today),
    customerRef: { $in: contracts.map((contract) => contract.customerRef).filter(Boolean) },
  };

  const workOrders = await WorkOrder.find(woQuery)
    .select("customerRef date")
    .lean();
  const latestByCustomer = new Map<string, Date>();
  for (const workOrder of workOrders) {
    const key = workOrder.customerRef ? String(workOrder.customerRef) : "";
    const date = parseDateOnly(workOrder.date);
    if (!key || !date) continue;
    const current = latestByCustomer.get(key);
    if (!current || date.getTime() > current.getTime()) {
      latestByCustomer.set(key, date);
    }
  }

  for (const contract of contracts) {
    const customerKey = contract.customerRef
      ? String(contract.customerRef)
      : "";
    const sourceDate =
      latestByCustomer.get(customerKey) ??
      parseDateOnly(contract.originalContractDate) ??
      parseDateOnly(contract.contractDate);
    if (!sourceDate || sourceDate.getTime() > today.getTime()) {
      log(
        `skip contract ${String(contract._id)}: no completed ASC visit on or before today`,
      );
      continue;
    }
    const derived = deriveAscContractDates(
      {
        originalContractDate: contract.originalContractDate,
        contractDate: contract.contractDate,
        lastRenewalDate: contract.lastRenewalDate,
        renewalDueDate: contract.renewalDueDate,
        durationMonths: contract.durationMonths,
        paidRenewalDueDate: latestPaidRenewalDueDate(contract.renewals),
        renewals: contract.renewals,
      },
      sourceDate,
    );
    if (!derived?.changed) continue;
    log(
      `${DRY_RUN ? "would reset" : "reset"} contract ${String(contract._id)} lastRenewal ${derived.lastRenewalDate.toISOString().slice(0, 10)} due ${derived.renewalDueDate.toISOString().slice(0, 10)}`,
    );
    if (DRY_RUN) continue;
    contract.originalContractDate = derived.originalContractDate;
    contract.contractDate = derived.contractDate;
    contract.lastRenewalDate = derived.lastRenewalDate;
    contract.renewalDueDate = derived.renewalDueDate;
    await contract.save();
  }
}

async function backfillMissingRenewalEvents(): Promise<void> {
  const paid = await Invoice.find({
    status: "paid",
    sourceType: { $in: ["contract_renewal", "contract_initial"] },
    contractRef: { $ne: null },
  });
  let missing = 0;
  for (const invoice of paid) {
    if (!invoice.contractRef) continue;
    const contract = await Contract.findById(invoice.contractRef);
    if (!contract) continue;
    const hasEvent = (contract.renewals ?? []).some(
      (renewal) =>
        renewal.invoiceRef &&
        String(renewal.invoiceRef) === String(invoice._id),
    );
    if (hasEvent) continue;
    missing += 1;
    const paidAt = parseDateOnly(invoice.paidAt) ?? invoice.paidAt ?? new Date();
    log(
      `${DRY_RUN ? "would backfill" : "backfilled"} renewal for ${invoice.number} on contract ${String(contract._id)} (dates unchanged)`,
    );
    if (DRY_RUN) continue;
    contract.renewals.push({
      renewedAt: paidAt,
      durationMonths: contract.durationMonths || 12,
      previousDueDate: contract.renewalDueDate ?? paidAt,
      newDueDate: contract.renewalDueDate ?? paidAt,
      wasLate: false,
      notes: `Paid via invoice ${invoice.number} (history backfill)`,
      invoiceRef: invoice._id as Types.ObjectId,
      amountCents: invoice.amountCents,
      paymentProvider: invoice.paymentProvider ?? undefined,
      providerPaymentId: invoice.providerPaymentId ?? undefined,
      createdAt: invoice.paidAt ?? new Date(),
    });
    contract.markModified("renewals");
    await contract.save();
  }
  log(`pass 3: ${missing} paid contract invoice${missing === 1 ? "" : "s"} missing a renewal event`);
}

async function reportMultiLinks(): Promise<void> {
  const open = await Invoice.find({
    sourceType: { $in: ["contract_initial", "contract_renewal"] },
    status: { $in: [...OPEN_PAYABLE_INVOICE_STATUSES] },
  })
    .select("customerRef number sourceType")
    .lean();
  const byCustomer = new Map<string, typeof open>();
  for (const invoice of open) {
    const key = invoice.customerRef ? String(invoice.customerRef) : "";
    if (!key) continue;
    const list = byCustomer.get(key) ?? [];
    list.push(invoice);
    byCustomer.set(key, list);
  }
  const multi = [...byCustomer.entries()].filter(([, list]) => list.length > 1);
  log(`pass 4: ${multi.length} customer${multi.length === 1 ? "" : "s"} with more than one open ASC payment link`);
  for (const [customerRef, list] of multi.slice(0, 40)) {
    log(
      `  ${customerRef}: ${list.map((invoice) => `${invoice.number} (${invoice.sourceType})`).join(", ")}`,
    );
  }
}

async function main(): Promise<void> {
  await connectMongoDB();
  log(DRY_RUN ? "dry-run (pass --apply to write)" : "applying repairs");
  await foldDuplicatePairs();
  await fixFutureDatedContracts();
  await backfillMissingRenewalEvents();
  await reportMultiLinks();
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("[repair-asc-renewals] Fatal:", err);
  process.exit(1);
});
