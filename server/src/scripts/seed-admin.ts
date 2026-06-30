/**
 * One-time script to create the initial admin user.
 * Run: npx tsx src/scripts/seed-admin.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { User } from "../models/mongo/User";
import { seedDefaultPermissions } from "../models/mongo/RolePermission";

const ADMIN_EMAIL = "pnelan@gmail.com";
const ADMIN_PASSWORD = "Digital2";
const ADMIN_FIRST_NAME = "Patrick";
const ADMIN_LAST_NAME = "Nelan";

async function main() {
  await connectMongoDB();

  // Seed role permissions if not already present
  await seedDefaultPermissions();

  const existing = await User.findOne({ email: ADMIN_EMAIL.toLowerCase() }).lean();
  if (existing) {
    console.log(`Admin user already exists (id: ${existing._id}). Nothing to do.`);
    await disconnectMongoDB();
    return;
  }

  const password_hash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const user = await User.create({
    email: ADMIN_EMAIL.toLowerCase(),
    password_hash,
    first_name: ADMIN_FIRST_NAME,
    last_name: ADMIN_LAST_NAME,
    role: "admin",
  });

  console.log(`Admin user created successfully (id: ${user._id})`);
  console.log(`  Email : ${ADMIN_EMAIL}`);
  console.log(`  Role  : admin`);

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
