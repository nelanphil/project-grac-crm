import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { User } from "../models/mongo/User";

async function main() {
  await connectMongoDB();

  const result = await User.findOneAndUpdate(
    { email: "pnelan@gmail.com" },
    { role: "super-admin" },
    { new: true }
  );

  if (!result) {
    console.error("User pnelan@gmail.com not found.");
  } else {
    console.log(`Updated: ${result.email} → role: ${result.role}`);
  }

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error(err);
  mongoose.disconnect();
  process.exit(1);
});
