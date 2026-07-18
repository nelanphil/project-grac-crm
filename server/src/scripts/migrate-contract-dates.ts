/**
 * Backfills contract date/renewal fields. Does not dedupe or delete rows —
 * customers may hold multiple contracts.
 * Run: npx tsx src/scripts/migrate-contract-dates.ts
 *
 * Run after migrate-contracts-collection.ts (rename + contractType backfill).
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { Contract } from "../models/mongo/Contract";
import {
  DEFAULT_DURATION_MONTHS,
  computeInitialRenewalDueDate,
  parseDateOnly,
} from "../utils/contractDates";

async function main(): Promise<void> {
  await connectMongoDB();

  const contracts = await Contract.find().lean();
  console.log(`Found ${contracts.length} contracts.`);

  let updated = 0;

  for (const contract of contracts) {
    const contractDate = parseDateOnly(contract.contractDate);
    const durationMonths = contract.durationMonths ?? DEFAULT_DURATION_MONTHS;
    const needsUpdate =
      contract.originalContractDate == null ||
      contract.durationMonths == null ||
      contract.renewalDueDate == null ||
      contract.lastRenewalDate === undefined ||
      !Array.isArray(contract.renewals);

    if (!needsUpdate) continue;

    await Contract.findByIdAndUpdate(contract._id, {
      $set: {
        originalContractDate: parseDateOnly(contract.originalContractDate) ?? contractDate,
        contractDate,
        durationMonths,
        renewalDueDate: contract.renewalDueDate
          ? parseDateOnly(contract.renewalDueDate)
          : computeInitialRenewalDueDate(contractDate, durationMonths),
        lastRenewalDate: contract.lastRenewalDate
          ? parseDateOnly(contract.lastRenewalDate)
          : null,
        renewals: contract.renewals ?? [],
      },
    });
    updated++;
  }

  console.log(`Updated ${updated} contracts.`);
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
