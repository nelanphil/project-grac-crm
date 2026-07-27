import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { SmsMessage } from "../models/mongo/SmsMessage";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";

async function main() {
  await connectMongoDB();

  const accounts = await TwilioAccount.find().select("_id accountSid").lean();
  const sidById = new Map(accounts.map((a) => [String(a._id), a.accountSid]));

  const messages = await SmsMessage.find().lean();
  let copied = 0;
  let skipped = 0;

  for (const msg of messages) {
    const accountSid = sidById.get(String(msg.twilioAccountRef));
    if (!accountSid) {
      skipped += 1;
      continue;
    }

    if (msg.twilioSid) {
      const existing = await TwilioCommunication.findOne({
        accountSid,
        twilioSid: msg.twilioSid,
      }).lean();
      if (existing) {
        skipped += 1;
        continue;
      }
    }

    await TwilioCommunication.create({
      twilioAccountRef: msg.twilioAccountRef,
      accountSid,
      channel: "sms",
      direction: "outbound",
      status: msg.status === "queued" ? "queued" : msg.status === "sent" ? "sent" : "failed",
      fromNumber: msg.fromNumber,
      toNumber: msg.toNumber,
      body: msg.body ?? "",
      mediaUrls: [],
      twilioSid: msg.twilioSid ?? null,
      customerRef: msg.customerRef ?? null,
      contactRef: msg.contactRef ?? null,
      templateRef: msg.templateRef ?? null,
      createdByUserRef: msg.createdByUserRef ?? null,
      errorMessage: msg.errorMessage ?? null,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    });
    copied += 1;
  }

  console.log(`Migrated ${copied} SMS rows; skipped ${skipped}`);
  await disconnectMongoDB();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
