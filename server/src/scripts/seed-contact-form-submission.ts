/**
 * Insert Amy Webb's October 17, 2026 contact-form submission.
 * Run: npx tsx src/scripts/seed-contact-form-submission.ts
 */
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

import mongoose from "mongoose";
import { connectMongoDB, disconnectMongoDB } from "../config/mongodb";
import { ContactFormSubmission } from "../models/mongo/ContactFormSubmission";
import { NotificationEvent } from "../models/mongo/NotificationEvent";
import { logNotification } from "../services/notification.service";

const SEED_KEY = "amy-webb-2026-10-17";
const SUBMITTED_AT = new Date("2026-10-18T00:48:00.000Z");

async function ensureStaffNotification(row: {
  _id: unknown;
  createdAt: Date;
}): Promise<void> {
  const entityId = String(row._id);
  const existing = await NotificationEvent.findOne({
    entityType: "contact_form",
    action: "created",
    entityId,
  })
    .select("_id")
    .lean();
  if (existing) {
    console.log(`Staff notification already exists (id: ${existing._id}).`);
    return;
  }

  await logNotification({
    entityType: "contact_form",
    action: "created",
    entityId,
    summary: "Amy Webb submitted the website contact form.",
    actorType: "system",
    actorName: "Amy Webb",
    metadata: { submittedAt: row.createdAt.toISOString() },
  });
  console.log("Created staff notification for Amy Webb.");
}

async function main() {
  await connectMongoDB();

  const existing = await ContactFormSubmission.findOne({ seedKey: SEED_KEY });
  if (existing) {
    console.log(
      `Contact form submission already seeded (id: ${existing._id}). Nothing to do.`,
    );
    await ensureStaffNotification(existing);
    await disconnectMongoDB();
    return;
  }

  const row = new ContactFormSubmission({
    firstName: "Amy",
    lastName: "Webb",
    email: "Wsarmw@yahoo.com",
    phone: "(386) 451-3381",
    message:
      "The orange service lite is on and it says check battery. Thank you. Amy",
    source: "website",
    readAt: null,
    seedKey: SEED_KEY,
  });
  row.createdAt = SUBMITTED_AT;
  await row.save();
  await ensureStaffNotification(row);

  console.log(`Seeded contact form submission (id: ${row._id})`);
  console.log("  Name : Amy Webb");
  console.log(`  At   : ${SUBMITTED_AT.toISOString()}`);

  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  mongoose.disconnect();
  process.exit(1);
});
