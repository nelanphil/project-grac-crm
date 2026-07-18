/**
 * Quick verify for Aaron Becker Port Orange vs Ormond Beach WO tagging.
 * Run: npx tsx src/scripts/verify-becker-addresses.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB, getMongoStatus } from "../config/mongodb";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { WorkOrder } from "../models/mongo/WorkOrder";

const ORMOND_WOS = [1242, 1425, 4662, 4674, 4708, 4722];
const PORT_WOS = [1206, 1571, 1616, 2436, 2808, 4189, 4298, 4933];

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error("MongoDB not connected");
    process.exit(1);
  }

  const ormond = await CustomerAddress.findOne({ legacyCustomerId: 1663 }).lean();
  const port = await CustomerAddress.findOne({ legacyCustomerId: 1655 }).lean();

  console.log(
    "Ormond address:",
    ormond?._id?.toString(),
    ormond?.address,
    ormond?.city
  );
  console.log(
    "Port Orange address:",
    port?._id?.toString(),
    port?.address,
    port?.city
  );

  const ormondWos = await WorkOrder.find({ legacyId: { $in: ORMOND_WOS } })
    .select("legacyId addressRef customerId")
    .lean();
  const portWos = await WorkOrder.find({ legacyId: { $in: PORT_WOS } })
    .select("legacyId addressRef customerId")
    .lean();

  const ormondId = ormond?._id?.toString();
  const portId = port?._id?.toString();

  const ormondOk = ormondWos.every((w) => w.addressRef?.toString() === ormondId);
  const portOk = portWos.every((w) => w.addressRef?.toString() === portId);

  console.log(
    `Ormond WOs: ${ormondWos.length}/6 on Ormond address? ${ormondOk}`
  );
  console.log(
    ormondWos.map((w) => ({
      legacyId: w.legacyId,
      addressRef: w.addressRef?.toString(),
      customerId: w.customerId,
    }))
  );
  console.log(
    `Port Orange WOs: ${portWos.length}/8 on Port address? ${portOk}`
  );

  if (ormond) {
    console.log(
      "Total WOs on Ormond addressRef:",
      await WorkOrder.countDocuments({ addressRef: ormond._id })
    );
  }
  if (port) {
    console.log(
      "Total WOs on Port Orange addressRef:",
      await WorkOrder.countDocuments({ addressRef: port._id })
    );
  }

  if (!ormondOk || !portOk) {
    process.exitCode = 1;
  }

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
