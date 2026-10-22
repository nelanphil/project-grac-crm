/**
 * Rebuild customer history from notification events and dated records.
 *
 * Idempotent: every row uses a stable sourceEventId, and upserts only insert
 * when that id is new. Safe to run more than once.
 *
 * Run from server/:
 *   npx tsx src/scripts/backfill-customer-activity.ts
 *   npx tsx src/scripts/backfill-customer-activity.ts --dry-run
 */
import dotenv from "dotenv";
import path from "path";

const envCandidates = [
  path.resolve(__dirname, "../../.env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(__dirname, "../../../.env"),
];
for (const envPath of envCandidates) {
  dotenv.config({ path: envPath });
}

import mongoose, { AnyBulkWriteOperation, Types } from "mongoose";
mongoose.set("autoIndex", false);

import {
  connectMongoDB,
  disconnectMongoDB,
  getMongoStatus,
} from "../config/mongodb";
import { Contract } from "../models/mongo/Contract";
import { Customer } from "../models/mongo/Customer";
import {
  ActivityActorKind,
  ActivityCategory,
  ActivitySource,
  CustomerActivity,
} from "../models/mongo/CustomerActivity";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { CustomerNote } from "../models/mongo/CustomerNote";
import { DiscountRedemption } from "../models/mongo/DiscountRedemption";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { Estimate } from "../models/mongo/Estimate";
import { Invoice } from "../models/mongo/Invoice";
import { NotificationEvent } from "../models/mongo/NotificationEvent";
import { SmsMessage } from "../models/mongo/SmsMessage";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { User } from "../models/mongo/User";
import {
  includingDeletedWorkOrders,
  WorkOrder,
} from "../models/mongo/WorkOrder";
import { isCustomerRole } from "../utils/roles";

const DRY_RUN = process.argv.includes("--dry-run");
const BATCH_SIZE = 400;

type ActivityInsert = {
  customerRef: Types.ObjectId;
  category: ActivityCategory;
  action: string;
  actorKind: ActivityActorKind;
  actorUserId: Types.ObjectId | null;
  actorName: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  changes: [];
  metadata: Record<string, unknown>;
  source: ActivitySource;
  ip: string | null;
  sourceEventId: string;
  backfilled: true;
  createdAt: Date;
  updatedAt: Date;
};

const covered = new Set<string>();
let queued = 0;
let written = 0;
const ops: AnyBulkWriteOperation[] = [];

function log(msg: string): void {
  console.log(`[backfill-customer-activity] ${msg}`);
}

function cover(entityType: string, entityId: string, action: string): void {
  covered.add(`${entityType}|${entityId}|${action}`);
}

function isCovered(entityType: string, entityId: string, action: string): boolean {
  return covered.has(`${entityType}|${entityId}|${action}`);
}

function clip(value: string, max = 80): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function money(cents: number): string {
  return (cents / 100).toFixed(2);
}

async function flush(): Promise<void> {
  if (ops.length === 0) return;
  const batch = ops.splice(0, ops.length);
  queued += batch.length;
  if (DRY_RUN) return;
  const result = await CustomerActivity.bulkWrite(batch, {
    ordered: false,
    timestamps: false,
  });
  written += result.upsertedCount ?? 0;
}

async function queue(doc: ActivityInsert): Promise<void> {
  if (!doc.createdAt || Number.isNaN(doc.createdAt.getTime())) return;
  ops.push({
    updateOne: {
      filter: { sourceEventId: doc.sourceEventId },
      update: { $setOnInsert: doc },
      upsert: true,
    },
  });
  if (ops.length >= BATCH_SIZE) await flush();
}

function row(
  input: Omit<ActivityInsert, "changes" | "backfilled" | "updatedAt" | "ip"> & {
    ip?: string | null;
  },
): ActivityInsert {
  return {
    ...input,
    changes: [],
    ip: input.ip ?? null,
    backfilled: true,
    updatedAt: input.createdAt,
  };
}

async function copyNotifications(): Promise<void> {
  const cursor = NotificationEvent.find({ customerRef: { $ne: null } })
    .select(
      "entityType action actorType actorUserId actorName customerRef entityId summary metadata createdAt",
    )
    .lean()
    .cursor();

  const kindCache = new Map<string, ActivityActorKind>();
  for await (const event of cursor) {
    if (!event.customerRef) continue;
    const entityId = String(event.entityId ?? "");
    cover(event.entityType, entityId, event.action);
    if (event.entityType === "invoice" && /paid/i.test(event.summary ?? "")) {
      cover("invoice", entityId, "paid");
    }

    let actorKind: ActivityActorKind = "system";
    if (event.actorType === "user" && event.actorUserId) {
      const key = String(event.actorUserId);
      const cached = kindCache.get(key);
      if (cached) {
        actorKind = cached;
      } else {
        const user = await User.findById(event.actorUserId)
          .select("userType role roles")
          .lean();
        actorKind = user && isCustomerRole(user) ? "customer" : "staff";
        kindCache.set(key, actorKind);
      }
    }

    await queue(
      row({
        customerRef: event.customerRef as Types.ObjectId,
        category: categoryFor(event.entityType),
        action: event.action,
        actorKind,
        actorUserId: (event.actorUserId as Types.ObjectId | null) ?? null,
        actorName: event.actorName || (actorKind === "system" ? "System" : "Staff"),
        entityType: event.entityType,
        entityId,
        summary: event.summary,
        metadata: (event.metadata as Record<string, unknown>) ?? {},
        source: "crm",
        sourceEventId: `notification:${String(event._id)}`,
        createdAt: event.createdAt,
      }),
    );
  }
  log(`queued notification copies (${covered.size} covered keys)`);
}

function categoryFor(entityType: string): ActivityCategory {
  const map: Record<string, ActivityCategory> = {
    customer: "account",
    contact: "contact",
    address: "address",
    equipment: "equipment",
    work_order: "work_order",
    contract: "contract",
    estimate: "estimate",
    invoice: "invoice",
    customer_note: "note",
    work_order_note: "note",
    estimate_note: "note",
    mailbox_message: "communication",
    contact_form: "communication",
    lead: "account",
    user: "auth",
    discount_code: "payment",
  };
  return map[entityType] ?? "account";
}

async function deriveRecords(): Promise<void> {
  const customers = Customer.find()
    .select("legacyId accountName first last createdAt mergedAt deletedAt")
    .lean()
    .cursor();
  const customerCreated = new Map<string, { legacy: boolean; createdAt: number }>();

  for await (const customer of customers) {
    const id = String(customer._id);
    customerCreated.set(id, {
      legacy: customer.legacyId != null,
      createdAt: customer.createdAt ? new Date(customer.createdAt).getTime() : 0,
    });
    const name =
      (customer.accountName ?? "").trim() ||
      `${customer.first ?? ""} ${customer.last ?? ""}`.trim() ||
      "Customer";
    if (customer.createdAt && customer.legacyId == null && !isCovered("customer", id, "created")) {
      await queue(
        row({
          customerRef: customer._id,
          category: "account",
          action: "created",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "customer",
          entityId: id,
          summary: `Customer ${name} created`,
          metadata: {},
          source: "job",
          sourceEventId: `customer:${id}:created`,
          createdAt: customer.createdAt,
        }),
      );
    }
    if (customer.mergedAt && !isCovered("customer", id, "merged")) {
      await queue(
        row({
          customerRef: customer._id,
          category: "account",
          action: "merged",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "customer",
          entityId: id,
          summary: `Customer ${name} was merged`,
          metadata: {},
          source: "job",
          sourceEventId: `customer:${id}:merged`,
          createdAt: customer.mergedAt,
        }),
      );
    }
    if (customer.deletedAt && !isCovered("customer", id, "deleted")) {
      await queue(
        row({
          customerRef: customer._id,
          category: "account",
          action: "deleted",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "customer",
          entityId: id,
          summary: `Customer ${name} deleted`,
          metadata: {},
          source: "job",
          sourceEventId: `customer:${id}:deleted`,
          createdAt: customer.deletedAt,
        }),
      );
    }
  }

  const contacts = CustomerContact.find({ customerRef: { $ne: null } })
    .select("customerRef first last createdAt")
    .lean()
    .cursor();
  for await (const contact of contacts) {
    if (!contact.customerRef || !contact.createdAt) continue;
    const customerId = String(contact.customerRef);
    const id = String(contact._id);
    if (isCovered("contact", id, "created")) continue;
    const parent = customerCreated.get(customerId);
    if (
      parent?.legacy &&
      Math.abs(new Date(contact.createdAt).getTime() - parent.createdAt) < 5000
    ) {
      continue;
    }
    const name = `${contact.first ?? ""} ${contact.last ?? ""}`.trim() || "Contact";
    await queue(
      row({
        customerRef: contact.customerRef,
        category: "contact",
        action: "created",
        actorKind: "system",
        actorUserId: null,
        actorName: "System",
        entityType: "contact",
        entityId: id,
        summary: `Contact ${name} added`,
        metadata: {},
        source: "job",
        sourceEventId: `contact:${id}:created`,
        createdAt: contact.createdAt,
      }),
    );
  }

  const orders = includingDeletedWorkOrders(
    WorkOrder.find({ customerRef: { $ne: null } }).select(
      "customerRef legacyId number createdAt signedAt signedByName appointmentCanceledAt deletedAt",
    ),
  )
    .lean()
    .cursor();
  for await (const order of orders) {
    if (!order.customerRef) continue;
    const id = String(order._id);
    const label = order.number || (order.legacyId ? `#${order.legacyId}` : "work order");
    if (order.createdAt && order.legacyId == null && !isCovered("work_order", id, "created")) {
      await queue(
        row({
          customerRef: order.customerRef,
          category: "work_order",
          action: "created",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "work_order",
          entityId: id,
          summary: `Work order ${label} created`,
          metadata: {},
          source: "job",
          sourceEventId: `work_order:${id}:created`,
          createdAt: order.createdAt,
        }),
      );
    }
    if (order.signedAt && !isCovered("work_order", id, "signed")) {
      await queue(
        row({
          customerRef: order.customerRef,
          category: "work_order",
          action: "signed",
          actorKind: "customer",
          actorUserId: null,
          actorName: order.signedByName?.trim() || "Customer",
          entityType: "work_order",
          entityId: id,
          summary: `${order.signedByName?.trim() || "Customer"} signed ${label}`,
          metadata: {},
          source: "job",
          sourceEventId: `work_order:${id}:signed`,
          createdAt: order.signedAt,
        }),
      );
    }
    if (order.appointmentCanceledAt) {
      await queue(
        row({
          customerRef: order.customerRef,
          category: "work_order",
          action: "canceled",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "work_order",
          entityId: id,
          summary: `Appointment canceled for ${label}`,
          metadata: {},
          source: "job",
          sourceEventId: `work_order:${id}:canceled`,
          createdAt: order.appointmentCanceledAt,
        }),
      );
    }
    if (order.deletedAt && !isCovered("work_order", id, "deleted")) {
      await queue(
        row({
          customerRef: order.customerRef,
          category: "work_order",
          action: "deleted",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "work_order",
          entityId: id,
          summary: `Work order ${label} deleted`,
          metadata: {},
          source: "job",
          sourceEventId: `work_order:${id}:deleted`,
          createdAt: order.deletedAt,
        }),
      );
    }
  }

  const contracts = Contract.find({ customerRef: { $ne: null } })
    .select("customerRef description contractType contractDate renewals")
    .lean()
    .cursor();
  for await (const contract of contracts) {
    if (!contract.customerRef) continue;
    const id = String(contract._id);
    const label = contract.contractType || contract.description || "Contract";
    if (contract.contractDate && !isCovered("contract", id, "created")) {
      await queue(
        row({
          customerRef: contract.customerRef,
          category: "contract",
          action: "created",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "contract",
          entityId: id,
          summary: `Contract started: ${clip(label, 60)}`,
          metadata: {},
          source: "job",
          sourceEventId: `contract:${id}:created`,
          createdAt: contract.contractDate,
        }),
      );
    }
    for (const [index, renewal] of (contract.renewals ?? []).entries()) {
      if (!renewal?.renewedAt) continue;
      await queue(
        row({
          customerRef: contract.customerRef,
          category: "contract",
          action: "renewed",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "contract",
          entityId: id,
          summary: `Contract renewed: ${clip(label, 60)}`,
          metadata: {},
          source: "job",
          sourceEventId: `contract:${id}:renewed:${index}`,
          createdAt: renewal.renewedAt,
        }),
      );
    }
  }

  const estimates = Estimate.find({ customerRef: { $ne: null } })
    .select("customerRef number createdAt signedAt signedByName")
    .lean()
    .cursor();
  for await (const estimate of estimates) {
    if (!estimate.customerRef) continue;
    const id = String(estimate._id);
    const label = estimate.number || "estimate";
    if (estimate.createdAt && !isCovered("estimate", id, "created")) {
      await queue(
        row({
          customerRef: estimate.customerRef,
          category: "estimate",
          action: "created",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "estimate",
          entityId: id,
          summary: `Estimate ${label} created`,
          metadata: {},
          source: "job",
          sourceEventId: `estimate:${id}:created`,
          createdAt: estimate.createdAt,
        }),
      );
    }
    if (estimate.signedAt && !isCovered("estimate", id, "signed")) {
      await queue(
        row({
          customerRef: estimate.customerRef,
          category: "estimate",
          action: "signed",
          actorKind: "customer",
          actorUserId: null,
          actorName: estimate.signedByName?.trim() || "Customer",
          entityType: "estimate",
          entityId: id,
          summary: `${estimate.signedByName?.trim() || "Customer"} signed estimate ${label}`,
          metadata: {},
          source: "job",
          sourceEventId: `estimate:${id}:signed`,
          createdAt: estimate.signedAt,
        }),
      );
    }
  }

  const invoices = Invoice.find({ customerRef: { $ne: null } })
    .select("customerRef number amountCents issuedAt paidAt paymentReceiptSentAt")
    .lean()
    .cursor();
  for await (const invoice of invoices) {
    if (!invoice.customerRef) continue;
    const id = String(invoice._id);
    if (invoice.issuedAt && !isCovered("invoice", id, "created")) {
      await queue(
        row({
          customerRef: invoice.customerRef,
          category: "invoice",
          action: "created",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "invoice",
          entityId: id,
          summary: `Invoice ${invoice.number} issued ($${money(invoice.amountCents ?? 0)})`,
          metadata: { amountCents: invoice.amountCents },
          source: "job",
          sourceEventId: `invoice:${id}:issued`,
          createdAt: invoice.issuedAt,
        }),
      );
    }
    if (invoice.paidAt && !isCovered("invoice", id, "paid")) {
      await queue(
        row({
          customerRef: invoice.customerRef,
          category: "payment",
          action: "paid",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "invoice",
          entityId: id,
          summary: `Invoice ${invoice.number} paid ($${money(invoice.amountCents ?? 0)})`,
          metadata: { amountCents: invoice.amountCents },
          source: "job",
          sourceEventId: `invoice:${id}:paid`,
          createdAt: invoice.paidAt,
        }),
      );
    }
    if (invoice.paymentReceiptSentAt) {
      await queue(
        row({
          customerRef: invoice.customerRef,
          category: "invoice",
          action: "sent",
          actorKind: "system",
          actorUserId: null,
          actorName: "System",
          entityType: "invoice",
          entityId: id,
          summary: `Payment receipt sent for invoice ${invoice.number}`,
          metadata: {},
          source: "job",
          sourceEventId: `invoice:${id}:receipt`,
          createdAt: invoice.paymentReceiptSentAt,
        }),
      );
    }
  }

  const notes = CustomerNote.find({ customerRef: { $ne: null } })
    .select("customerRef authorId content createdAt")
    .lean()
    .cursor();
  for await (const note of notes) {
    if (!note.customerRef || !note.createdAt) continue;
    const id = String(note._id);
    if (isCovered("customer_note", id, "created")) continue;
    await queue(
      row({
        customerRef: note.customerRef,
        category: "note",
        action: "created",
        actorKind: "staff",
        actorUserId: note.authorId ?? null,
        actorName: "Staff",
        entityType: "customer_note",
        entityId: id,
        summary: `Note added: ${clip(note.content ?? "")}`,
        metadata: {},
        source: "crm",
        sourceEventId: `customer_note:${id}:created`,
        createdAt: note.createdAt,
      }),
    );
  }

  const texts = SmsMessage.find({ customerRef: { $ne: null } })
    .select("customerRef body createdByUserRef createdAt")
    .lean()
    .cursor();
  for await (const text of texts) {
    if (!text.customerRef || !text.createdAt) continue;
    const id = String(text._id);
    await queue(
      row({
        customerRef: text.customerRef,
        category: "communication",
        action: "sent",
        actorKind: text.createdByUserRef ? "staff" : "system",
        actorUserId: text.createdByUserRef ?? null,
        actorName: text.createdByUserRef ? "Staff" : "System",
        entityType: "sms_message",
        entityId: id,
        summary: `Sent a text: ${clip(text.body ?? "")}`,
        metadata: {},
        source: "crm",
        sourceEventId: `sms:${id}:sent`,
        createdAt: text.createdAt,
      }),
    );
  }

  const twilio = TwilioCommunication.find({ customerRef: { $ne: null } })
    .select(
      "customerRef channel direction body fromNumber createdByUserRef threadRef createdAt",
    )
    .lean()
    .cursor();
  for await (const message of twilio) {
    if (!message.customerRef || !message.createdAt) continue;
    const id = String(message._id);
    const inbound = message.direction === "inbound";
    const call = message.channel === "voice";
    await queue(
      row({
        customerRef: message.customerRef,
        category: "communication",
        action: call ? "called" : inbound ? "received" : "sent",
        actorKind: inbound || call ? "customer" : message.createdByUserRef ? "staff" : "system",
        actorUserId: message.createdByUserRef ?? null,
        actorName: inbound || call ? "Customer" : message.createdByUserRef ? "Staff" : "System",
        entityType: "twilio_communication",
        entityId: id,
        summary: call
          ? `${inbound ? "Received" : "Placed"} a call${message.fromNumber ? ` (${message.fromNumber})` : ""}`
          : `${inbound ? "Received" : "Sent"} a text: ${clip(message.body ?? "")}`,
        metadata: message.threadRef
          ? { threadId: String(message.threadRef) }
          : {},
        source: inbound ? "webhook" : "crm",
        sourceEventId: `twilio-row:${id}`,
        createdAt: message.createdAt,
      }),
    );
  }

  const emails = EmailCommunication.find({ customerRef: { $ne: null } })
    .select("customerRef subject toEmail createdByUserRef status createdAt")
    .lean()
    .cursor();
  for await (const email of emails) {
    if (!email.customerRef || !email.createdAt) continue;
    const id = String(email._id);
    await queue(
      row({
        customerRef: email.customerRef,
        category: "communication",
        action: email.status === "failed" ? "failed" : "sent",
        actorKind: email.createdByUserRef ? "staff" : "system",
        actorUserId: email.createdByUserRef ?? null,
        actorName: email.createdByUserRef ? "Staff" : "System",
        entityType: "email_communication",
        entityId: id,
        summary: email.subject
          ? `Sent an email: ${clip(email.subject, 70)}`
          : `Sent an email to ${email.toEmail}`,
        metadata: {},
        source: "crm",
        sourceEventId: `email:${id}`,
        createdAt: email.createdAt,
      }),
    );
  }

  const redemptions = DiscountRedemption.find({ customerRef: { $ne: null } })
    .select("customerRef code discountCents createdAt")
    .lean()
    .cursor();
  for await (const redemption of redemptions) {
    if (!redemption.customerRef || !redemption.createdAt) continue;
    const id = String(redemption._id);
    await queue(
      row({
        customerRef: redemption.customerRef,
        category: "payment",
        action: "redeemed",
        actorKind: "customer",
        actorUserId: null,
        actorName: "Customer",
        entityType: "discount_redemption",
        entityId: id,
        summary: `Redeemed discount ${redemption.code} ($${money(redemption.discountCents ?? 0)})`,
        metadata: {},
        source: "portal",
        sourceEventId: `discount:${id}`,
        createdAt: redemption.createdAt,
      }),
    );
  }

  const users = User.find({
    $or: [
      { termsAcceptedAt: { $ne: null } },
      { privacyAcceptedAt: { $ne: null } },
      { smsOptInAt: { $ne: null } },
      { lastLoginAt: { $ne: null } },
    ],
  })
    .select("_id userType role roles termsAcceptedAt privacyAcceptedAt smsOptInAt lastLoginAt")
    .lean()
    .cursor();
  for await (const user of users) {
    if (!isCustomerRole(user)) continue;
    const links = await CustomerContact.find({
      userRef: user._id,
      deletedAt: null,
    })
      .select("customerRef")
      .lean();
    const refs = [...new Set(links.map((link) => String(link.customerRef)).filter(Boolean))];
    const events: Array<{ action: string; summary: string; at: Date | null | undefined }> = [
      { action: "consent_accepted", summary: "Accepted terms", at: user.termsAcceptedAt },
      { action: "consent_accepted", summary: "Accepted privacy policy", at: user.privacyAcceptedAt },
      { action: "opted_in", summary: "Opted in to text messages", at: user.smsOptInAt },
      { action: "logged_in", summary: "Signed in", at: user.lastLoginAt },
    ];
    for (const ref of refs) {
      for (const event of events) {
        if (!event.at) continue;
        await queue(
          row({
            customerRef: new Types.ObjectId(ref),
            category: event.action === "opted_in" ? "communication" : "auth",
            action: event.action,
            actorKind: "customer",
            actorUserId: user._id as Types.ObjectId,
            actorName: "Customer",
            entityType: "user",
            entityId: String(user._id),
            summary: event.summary,
            metadata: {},
            source: "portal",
            sourceEventId: `user:${String(user._id)}:${event.action}:${event.summary}:${ref}`,
            createdAt: event.at,
          }),
        );
      }
    }
  }
}

async function fillThreadIds(): Promise<void> {
  const missing = await CustomerActivity.find({
    entityType: "twilio_communication",
    entityId: { $type: "string", $ne: "" },
    $or: [
      { "metadata.threadId": { $exists: false } },
      { "metadata.threadId": null },
      { "metadata.threadId": "" },
    ],
  })
    .select("entityId")
    .lean();
  if (missing.length === 0) {
    log("message thread ids already present");
    return;
  }

  const ids = [
    ...new Set(
      missing
        .map((entry) => entry.entityId)
        .filter((id): id is string => Boolean(id && Types.ObjectId.isValid(id))),
    ),
  ];
  const messages = await TwilioCommunication.find({ _id: { $in: ids } })
    .select("threadRef")
    .lean();
  const threadById = new Map(
    messages
      .filter((message) => message.threadRef)
      .map((message) => [String(message._id), String(message.threadRef)]),
  );

  const updates: AnyBulkWriteOperation[] = [];
  for (const entry of missing) {
    const threadId = entry.entityId ? threadById.get(entry.entityId) : undefined;
    if (!threadId) continue;
    updates.push({
      updateOne: {
        filter: { _id: entry._id },
        update: { $set: { "metadata.threadId": threadId } },
      },
    });
  }
  if (updates.length === 0) {
    log("no message threads to attach");
    return;
  }
  if (!DRY_RUN) {
    await CustomerActivity.bulkWrite(updates, { ordered: false });
  }
  log(
    `${DRY_RUN ? "would set" : "set"} threadId on ${updates.length} message rows`,
  );
}

async function main(): Promise<void> {
  await connectMongoDB();
  if (getMongoStatus() !== "connected") {
    console.error(
      "[backfill-customer-activity] MongoDB is not connected. Check MONGODB_URI_* in env.",
    );
    process.exit(1);
  }
  await CustomerActivity.createIndexes();
  log(DRY_RUN ? "dry run" : "writing");
  await copyNotifications();
  await deriveRecords();
  await flush();
  await fillThreadIds();
  log(
    DRY_RUN
      ? `would upsert ${queued} history rows`
      : `upserted ${written} new history rows (${queued} examined)`,
  );
  await disconnectMongoDB();
}

main().catch((err) => {
  console.error("[backfill-customer-activity] failed:", err);
  process.exit(1);
});
