import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose, { Types } from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { MessageThread } from "../models/mongo/MessageThread";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { toE164 } from "../utils/messagingContext";

// NOTE: every historical (contactRef, ourNumber) pair is collapsed into a
// single "open" thread — there is no time-gap splitting. This mirrors how
// the feature was specced ("assign a pseudo thread id back to the log"), but
// it's a one-way decision: re-running after live threads have opened/closed
// will not re-derive that history, it only fills in threadRef for rows that
// don't have one yet.
async function main() {
  await connectMongoDB();

  const rows = await TwilioCommunication.find({ contactRef: { $ne: null } })
    .sort({ createdAt: 1 })
    .lean();

  type Row = (typeof rows)[number];
  const groups = new Map<string, Row[]>();
  let skippedNoContact = 0;

  for (const row of rows) {
    if (!row.contactRef) {
      skippedNoContact += 1;
      continue;
    }
    const rawOurNumber =
      row.direction === "outbound" ? row.fromNumber : row.toNumber;
    const ourNumber = toE164(rawOurNumber) ?? rawOurNumber;
    const key = `${String(row.contactRef)}|${ourNumber}`;
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  let threadsCreated = 0;
  let threadsReused = 0;
  let rowsStamped = 0;

  for (const [key, groupRows] of groups) {
    const [contactId, ourNumber] = key.split("|");
    const contactRef = new Types.ObjectId(contactId);

    let thread = await MessageThread.findOne({ contactRef, ourNumber });
    if (thread) {
      threadsReused += 1;
    } else {
      const last = groupRows[groupRows.length - 1];
      const contact = await CustomerContact.findById(contactRef)
        .select("phone")
        .lean();

      thread = await MessageThread.create({
        contactRef,
        customerRef: last.customerRef ?? null,
        twilioAccountRef: last.twilioAccountRef,
        accountSid: last.accountSid,
        ourNumber,
        contactPhoneSnapshot: contact?.phone ?? "",
        status: "open",
        startedByUserRef: null,
        lastMessageAt: last.createdAt,
        lastMessageDirection: last.direction,
        lastMessageChannel: last.channel,
        lastMessagePreview: (last.body || "").slice(0, 160),
        messageCount: groupRows.length,
        createdAt: groupRows[0].createdAt,
        updatedAt: last.createdAt,
      });
      threadsCreated += 1;
    }

    const idsToStamp = groupRows
      .filter((r) => !r.threadRef)
      .map((r) => r._id);
    if (idsToStamp.length > 0) {
      await TwilioCommunication.updateMany(
        { _id: { $in: idsToStamp } },
        { $set: { threadRef: thread._id } },
      );
      rowsStamped += idsToStamp.length;
    }
  }

  console.log(
    `Threads created: ${threadsCreated}; reused: ${threadsReused}; rows stamped: ${rowsStamped}; rows skipped (no contact): ${skippedNoContact}`,
  );
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
