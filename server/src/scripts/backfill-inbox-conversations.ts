/**
 * Build Inboxes conversations from Twilio and email history.
 *
 * Safe to rerun. The latest message is refreshed. A conversation is marked
 * unread only when that latest message is inbound and still unread.
 *
 *   npx tsx src/scripts/backfill-inbox-conversations.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { rebuildInboxConversations } from "../services/inboxConversation.service";

async function main() {
  await connectMongoDB();
  const result = await rebuildInboxConversations();
  console.log(
    `Done. ${result.conversations} conversations from ${result.messages} messages.`,
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await disconnectMongoDB().catch(() => undefined);
  process.exit(1);
});
