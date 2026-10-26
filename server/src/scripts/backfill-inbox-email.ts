/**
 * Copy recent INBOX mail into EmailCommunication and refresh Inboxes.
 *
 * The live mailbox watcher only imports mail that arrives after the first
 * baseline. Run this once to pull history.
 *
 *   npx tsx src/scripts/backfill-inbox-email.ts
 *   npx tsx src/scripts/backfill-inbox-email.ts --days 30
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { EmailAccount } from "../models/mongo/EmailAccount";
import { importInboxHistory } from "../services/emailInboxSync.service";

function daysArg(): number {
  const eq = process.argv.find((arg) => arg.startsWith("--days="));
  if (eq) return Number(eq.split("=")[1]);
  const index = process.argv.indexOf("--days");
  if (index >= 0) return Number(process.argv[index + 1]);
  return 90;
}

async function main() {
  const days = daysArg();
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error("--days must be a positive number");
  }
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  await connectMongoDB();
  const accounts = await EmailAccount.find({ isActive: true });
  let imported = 0;
  for (const account of accounts) {
    if (!account.imapHost?.trim() || !account.passwordEncrypted) {
      console.log(`skip ${account.friendlyName}: IMAP is not configured`);
      continue;
    }
    const count = await importInboxHistory(account, since);
    imported += count;
    console.log(`${account.friendlyName}: imported ${count}`);
  }
  console.log(`Done. ${imported} new email${imported === 1 ? "" : "s"} since ${since.toISOString()}.`);
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongoDB().catch(() => undefined);
  process.exit(1);
});
