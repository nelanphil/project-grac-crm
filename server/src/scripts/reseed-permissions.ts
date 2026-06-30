import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { RolePermission, seedDefaultPermissions } from "../models/mongo/RolePermission";

async function main() {
  await connectMongoDB();

  const { deletedCount } = await RolePermission.deleteMany({});
  console.log(`Dropped ${deletedCount} existing role permission docs`);

  await seedDefaultPermissions();
  console.log("Re-seed complete");

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("Reseed failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
