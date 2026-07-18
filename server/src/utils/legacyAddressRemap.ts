import fs from "fs";
import path from "path";
import { Types } from "mongoose";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { Contract } from "../models/mongo/Contract";
import { Equipment } from "../models/mongo/Equipment";
import { WorkOrder } from "../models/mongo/WorkOrder";

const DEFAULT_DUMP_PATH = path.resolve(
  __dirname,
  "../scripts/database_dump/work_orders.sql"
);

/** Match INSERT row starts: (woId, userId, customerId, ... */
const WO_ROW_RE = /^\((\d+),\s*\d+,\s*(\d+),/gm;

/**
 * Parse work_orders.sql dump into Map<originalCustomerId, woLegacyIds[]>.
 */
export function parseWorkOrderLegacyCustomerMap(
  dumpPath: string = DEFAULT_DUMP_PATH
): Map<number, number[]> {
  const sql = fs.readFileSync(dumpPath, "utf8");
  const byCustomer = new Map<number, number[]>();

  for (const match of sql.matchAll(WO_ROW_RE)) {
    const woLegacyId = parseInt(match[1], 10);
    const customerId = parseInt(match[2], 10);
    if (Number.isNaN(woLegacyId) || Number.isNaN(customerId)) continue;
    const list = byCustomer.get(customerId) ?? [];
    list.push(woLegacyId);
    byCustomer.set(customerId, list);
  }

  return byCustomer;
}

export interface RemapLegacyAddressResult {
  addressesProcessed: number;
  workOrdersUpdated: number;
  contractsUpdated: number;
  perLegacyCustomer: Array<{
    legacyCustomerId: number;
    addressId: string;
    woIds: number[];
    woModified: number;
    contractModified: number;
  }>;
}

async function mapPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () =>
      worker()
    )
  );
}

/**
 * Remap WO/contract addressRef (and equipmentRef when unambiguous) using
 * CustomerAddress.legacyCustomerId + dump WO legacyId → original customer_id.
 *
 * Always overwrites WO addressRef from dump ownership so wrongly stamped
 * Port Orange tags on Ormond Beach WOs get corrected after merge.
 */
export async function remapAddressRefsFromLegacyDump(opts: {
  dryRun?: boolean;
  dumpPath?: string;
  log?: (msg: string) => void;
  /** Only log rows that would change (or always for specific legacy ids). */
  verboseLegacyIds?: number[];
}): Promise<RemapLegacyAddressResult> {
  const dryRun = Boolean(opts.dryRun);
  const log = opts.log ?? (() => undefined);
  const verbose = new Set(opts.verboseLegacyIds ?? [1655, 1663]);
  const byCustomer = parseWorkOrderLegacyCustomerMap(opts.dumpPath);

  log(`Parsed dump: ${byCustomer.size} original customers with work orders`);

  const addresses = await CustomerAddress.find({
    legacyCustomerId: { $ne: null, $exists: true },
  })
    .select("_id legacyCustomerId customerRef")
    .lean();

  log(`Found ${addresses.length} addresses with legacyCustomerId`);

  const equipmentByAddress = new Map<string, Types.ObjectId[]>();
  const allEquipment = await Equipment.find()
    .select("_id addressRef")
    .lean();
  for (const eq of allEquipment) {
    const key = eq.addressRef.toString();
    const list = equipmentByAddress.get(key) ?? [];
    list.push(eq._id as Types.ObjectId);
    equipmentByAddress.set(key, list);
  }

  const result: RemapLegacyAddressResult = {
    addressesProcessed: 0,
    workOrdersUpdated: 0,
    contractsUpdated: 0,
    perLegacyCustomer: [],
  };

  const work: typeof addresses = [];
  for (const addr of addresses) {
    if (addr.legacyCustomerId == null) continue;
    if (!byCustomer.has(addr.legacyCustomerId)) continue;
    work.push(addr);
  }

  log(`Addresses with matching dump WOs: ${work.length}`);

  let done = 0;
  await mapPool(work, 25, async (addr) => {
    const legacyCustomerId = addr.legacyCustomerId!;
    const woIds = byCustomer.get(legacyCustomerId) ?? [];
    if (woIds.length === 0) return;

    const eqs = equipmentByAddress.get(addr._id.toString()) ?? [];
    const equipmentId = eqs.length === 1 ? eqs[0] : null;

    const setFields: Record<string, unknown> = { addressRef: addr._id };
    if (equipmentId) {
      setFields.equipmentRef = equipmentId;
    }

    let woModified = 0;
    let contractModified = 0;

    if (dryRun) {
      woModified = await WorkOrder.countDocuments({
        legacyId: { $in: woIds },
        $or: [
          { addressRef: null },
          { addressRef: { $exists: false } },
          { addressRef: { $ne: addr._id } },
        ],
      });
      if (woModified > 0 || verbose.has(legacyCustomerId)) {
        const existing = await WorkOrder.countDocuments({
          legacyId: { $in: woIds },
        });
        log(
          `DRY_RUN legacyCustomerId=${legacyCustomerId} address=${addr._id}: dump=${woIds.length}, mongo=${existing}, wouldFix=${woModified}`
        );
      }
    } else {
      const woResult = await WorkOrder.updateMany(
        { legacyId: { $in: woIds } },
        { $set: setFields }
      );
      woModified = woResult.modifiedCount;

      const contractResult = await Contract.updateMany(
        {
          $or: [{ customerId: legacyCustomerId }, { addressRef: addr._id }],
        },
        { $set: setFields }
      );
      contractModified = contractResult.modifiedCount;

      if (verbose.has(legacyCustomerId)) {
        log(
          `legacyCustomerId=${legacyCustomerId} address=${addr._id}: WOs modified=${woModified}/${woIds.length}, contracts=${contractModified}`
        );
      } else if (woModified > 0 || contractModified > 0) {
        // keep quiet; progress line covers bulk
      }
    }

    result.addressesProcessed += 1;
    result.perLegacyCustomer.push({
      legacyCustomerId,
      addressId: addr._id.toString(),
      woIds,
      woModified,
      contractModified,
    });

    done += 1;
    if (done % 500 === 0) {
      log(`  progress ${done}/${work.length}`);
    }
  });

  result.workOrdersUpdated = result.perLegacyCustomer.reduce(
    (sum, row) => sum + row.woModified,
    0
  );
  result.contractsUpdated = result.perLegacyCustomer.reduce(
    (sum, row) => sum + row.contractModified,
    0
  );

  return result;
}
