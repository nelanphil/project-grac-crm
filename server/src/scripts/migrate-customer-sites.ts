/**
 * Migrates flat customer address/equipment into CustomerAddress + Equipment
 * collections and backfills addressRef / equipmentRef on work orders and contracts.
 *
 * Idempotent. Run from server/:
 *   npx tsx src/scripts/migrate-customer-sites.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose, { Types } from "mongoose";
import { connectMongoDB, disconnectMongoDB, getMongoStatus } from "../config/mongodb";
import { Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { Contract } from "../models/mongo/Contract";
import { Equipment } from "../models/mongo/Equipment";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  customerHasEquipmentData,
  customerHasSiteData,
  defaultAddressLabel,
} from "../utils/customerSites";
import { remapAddressRefsFromLegacyDump } from "../utils/legacyAddressRemap";

function log(msg: string): void {
  console.log(`[migrate-customer-sites] ${msg}`);
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker()
  );
  await Promise.all(workers);
}

async function main(): Promise<void> {
  const started = Date.now();
  log("Connecting to MongoDB…");
  await connectMongoDB();

  if (getMongoStatus() !== "connected") {
    console.error(
      "[migrate-customer-sites] MongoDB is not connected. Check MONGODB_URI_DEVELOPMENT / MONGODB_URI in .env"
    );
    process.exit(1);
  }

  mongoose.set("bufferCommands", false);

  log("Loading customers…");
  const customers = await Customer.find({
    $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
  })
    .select(
      "_id legacyId address city state zip generatorModel serial atsSerial lastSvc exday extime"
    )
    .lean();
  log(`Found ${customers.length} customers`);

  log("Loading existing addresses…");
  const existingAddresses = await CustomerAddress.find()
    .select("_id customerRef")
    .lean();
  const customersWithAddresses = new Set(
    existingAddresses.map((a) => a.customerRef.toString())
  );

  const toCreate = customers.filter(
    (c) => !customersWithAddresses.has(c._id.toString()) && customerHasSiteData(c)
  );
  const skippedEmpty = customers.filter(
    (c) => !customersWithAddresses.has(c._id.toString()) && !customerHasSiteData(c)
  ).length;
  const skippedWithSites = customersWithAddresses.size;

  log(
    `Creating addresses for ${toCreate.length} customers (${skippedWithSites} already have addresses, ${skippedEmpty} empty)…`
  );

  if (toCreate.length > 0) {
    const addressDocs = toCreate.map((c) => ({
      customerRef: c._id,
      label: defaultAddressLabel(c.city, c.address),
      address: c.address ?? "",
      city: c.city ?? "",
      state: c.state ?? "",
      zip: c.zip ?? "",
      isPrimary: true,
      legacyCustomerId: c.legacyId ?? null,
    }));

    const inserted = await CustomerAddress.insertMany(addressDocs, {
      ordered: false,
    });

    const equipmentDocs = [];
    for (let i = 0; i < toCreate.length; i++) {
      const c = toCreate[i];
      if (!customerHasEquipmentData(c)) continue;
      equipmentDocs.push({
        customerRef: c._id,
        addressRef: inserted[i]._id,
        generatorModel: c.generatorModel ?? "",
        serial: c.serial ?? "",
        atsSerial: c.atsSerial ?? "",
        lastSvc: c.lastSvc ?? null,
        exday: c.exday ?? "",
        extime: c.extime ?? "",
      });
    }

    if (equipmentDocs.length > 0) {
      await Equipment.insertMany(equipmentDocs, { ordered: false });
    }

    log(`Created ${inserted.length} addresses and ${equipmentDocs.length} equipment records`);
  }

  log("Reloading addresses for backfill…");
  const allAddresses = await CustomerAddress.find()
    .select("_id customerRef")
    .lean();

  const addressesByCustomer = new Map<string, Types.ObjectId[]>();
  for (const addr of allAddresses) {
    const key = addr.customerRef.toString();
    const list = addressesByCustomer.get(key) ?? [];
    list.push(addr._id as Types.ObjectId);
    addressesByCustomer.set(key, list);
  }

  const singleAddressCustomers = customers.filter((c) => {
    const addrs = addressesByCustomer.get(c._id.toString());
    return addrs?.length === 1;
  });

  log(
    `Backfilling addressRef on WOs/contracts for ${singleAddressCustomers.length} single-address customers…`
  );

  let woUpdated = 0;
  let contractUpdated = 0;
  let done = 0;

  await mapPool(singleAddressCustomers, 20, async (customer) => {
    const addressId = addressesByCustomer.get(customer._id.toString())![0];

    const [woResult, contractResult] = await Promise.all([
      WorkOrder.updateMany(
        {
          customerId: customer.legacyId,
          $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
        },
        { $set: { addressRef: addressId, customerRef: customer._id } }
      ),
      Contract.updateMany(
        {
          customerId: customer.legacyId,
          $or: [{ addressRef: null }, { addressRef: { $exists: false } }],
        },
        { $set: { addressRef: addressId, customerRef: customer._id } }
      ),
    ]);

    woUpdated += woResult.modifiedCount;
    contractUpdated += contractResult.modifiedCount;
    done += 1;
    if (done % 200 === 0) {
      log(`  addressRef progress ${done}/${singleAddressCustomers.length}`);
    }
  });

  log("Loading equipment for equipmentRef backfill…");
  const allEquipment = await Equipment.find().select("_id addressRef").lean();
  const equipmentByAddress = new Map<string, Types.ObjectId[]>();
  for (const eq of allEquipment) {
    const key = eq.addressRef.toString();
    const list = equipmentByAddress.get(key) ?? [];
    list.push(eq._id as Types.ObjectId);
    equipmentByAddress.set(key, list);
  }

  const singleEquipmentAddresses = [...equipmentByAddress.entries()].filter(
    ([, eqs]) => eqs.length === 1
  );

  log(
    `Backfilling equipmentRef for ${singleEquipmentAddresses.length} addresses with one equipment unit…`
  );

  let woEquipmentUpdated = 0;
  let contractEquipmentUpdated = 0;
  done = 0;

  await mapPool(singleEquipmentAddresses, 20, async ([addressId, eqs]) => {
    const equipmentId = eqs[0];
    const [woEq, contractEq] = await Promise.all([
      WorkOrder.updateMany(
        {
          addressRef: addressId,
          $or: [{ equipmentRef: null }, { equipmentRef: { $exists: false } }],
        },
        { $set: { equipmentRef: equipmentId } }
      ),
      Contract.updateMany(
        {
          addressRef: addressId,
          $or: [{ equipmentRef: null }, { equipmentRef: { $exists: false } }],
        },
        { $set: { equipmentRef: equipmentId } }
      ),
    ]);
    woEquipmentUpdated += woEq.modifiedCount;
    contractEquipmentUpdated += contractEq.modifiedCount;
    done += 1;
    if (done % 200 === 0) {
      log(`  equipmentRef progress ${done}/${singleEquipmentAddresses.length}`);
    }
  });

  // Final pass: heal merged multi-address customers using the SQL dump
  // (WO legacyId → original customer_id → CustomerAddress.legacyCustomerId)
  log("Remapping addressRef from legacy dump (merged multi-address heal)…");
  const legacyRemap = await remapAddressRefsFromLegacyDump({ log });
  log(
    `Legacy remap: addresses=${legacyRemap.addressesProcessed}, WOs=${legacyRemap.workOrdersUpdated}, contracts=${legacyRemap.contractsUpdated}`
  );

  const elapsedSec = ((Date.now() - started) / 1000).toFixed(1);
  log(`Customers scanned: ${customers.length}`);
  log(`Addresses created: ${toCreate.length}`);
  log(`Already had addresses: ${skippedWithSites}`);
  log(`Empty flat address data (skipped): ${skippedEmpty}`);
  log(`Work orders addressRef backfilled: ${woUpdated}`);
  log(`Contracts addressRef backfilled: ${contractUpdated}`);
  log(`Work orders equipmentRef backfilled: ${woEquipmentUpdated}`);
  log(`Contracts equipmentRef backfilled: ${contractEquipmentUpdated}`);
  log(
    `Legacy dump remap WOs: ${legacyRemap.workOrdersUpdated}, contracts: ${legacyRemap.contractsUpdated}`
  );
  log(`Finished in ${elapsedSec}s`);

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("[migrate-customer-sites] Fatal:", err);
  process.exit(1);
});
