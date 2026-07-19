/**
 * Heal/rebalance all username groups.
 * Run: npx tsx src/scripts/heal-usernames.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { User } from "../models/mongo/User";
import { rebalanceUsernameGroup } from "../utils/username";

async function main(): Promise<void> {
  await connectMongoDB();

  const bases = await User.distinct("username", {
    username: { $type: "string", $ne: null },
    deletedAt: null,
  });

  console.log(`Found ${bases.length} username group(s):`, bases);

  for (const base of bases) {
    if (!base) continue;
    const oldest = await User.findOne({
      username: base,
      deletedAt: null,
    })
      .sort({ createdAt: 1 })
      .select("_id")
      .lean();
    if (!oldest) continue;
    await rebalanceUsernameGroup(base, oldest._id);
    const after = await User.find({ username: base, deletedAt: null })
      .select("email username usernameKey createdAt")
      .sort({ createdAt: 1 })
      .lean();
    console.log(base, after);
  }

  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await disconnectMongoDB();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
