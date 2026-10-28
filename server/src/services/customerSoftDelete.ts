import { Types } from "mongoose";
import {
  activeContactFilter,
  CustomerContact,
} from "../models/mongo/CustomerContact";
import { Invoice } from "../models/mongo/Invoice";
import { ScheduledEmailSend } from "../models/mongo/ScheduledEmailSend";
import { ScheduledMessageSend } from "../models/mongo/ScheduledMessageSend";

export type CustomerSoftDeleteCascade = {
  invoicesVoided: number;
  scheduledEmailsUpdated: number;
  scheduledEmailsCancelled: number;
  scheduledMessagesUpdated: number;
  scheduledMessagesCancelled: number;
};

/**
 * Stop renewal activity for customers that are being soft-deleted.
 *
 * Voids open contract-renewal invoices and removes the customers' contacts
 * from scheduled email and SMS sends, cancelling a send that has no contacts
 * left. Restoring a customer does not undo this: voided invoices stay void
 * and cancelled sends stay cancelled.
 */
export async function cascadeCustomerSoftDelete(
  customerIds: readonly (Types.ObjectId | string)[],
): Promise<CustomerSoftDeleteCascade> {
  const ids = [
    ...new Set(
      customerIds
        .map((id) => String(id))
        .filter((id) => Types.ObjectId.isValid(id)),
    ),
  ].map((id) => new Types.ObjectId(id));

  const empty: CustomerSoftDeleteCascade = {
    invoicesVoided: 0,
    scheduledEmailsUpdated: 0,
    scheduledEmailsCancelled: 0,
    scheduledMessagesUpdated: 0,
    scheduledMessagesCancelled: 0,
  };
  if (ids.length === 0) return empty;

  const invoiceResult = await Invoice.updateMany(
    {
      customerRef: { $in: ids },
      sourceType: "contract_renewal",
      status: { $in: ["draft", "open"] },
    },
    { $set: { status: "void" } },
  );

  const contacts = await CustomerContact.find({
    customerRef: { $in: ids },
    ...activeContactFilter,
  })
    .select("_id")
    .lean();
  const contactIds = contacts.map((contact) => String(contact._id));
  const now = new Date();
  const [emails, messages] = await Promise.all([
    pruneScheduledContacts(asContactSendModel(ScheduledEmailSend), contactIds, now),
    pruneScheduledContacts(asContactSendModel(ScheduledMessageSend), contactIds, now),
  ]);

  return {
    invoicesVoided: invoiceResult.modifiedCount,
    scheduledEmailsUpdated: emails.updated,
    scheduledEmailsCancelled: emails.cancelled,
    scheduledMessagesUpdated: messages.updated,
    scheduledMessagesCancelled: messages.cancelled,
  };
}

type ContactSendModel = {
  updateMany(
    filter: { status: "scheduled"; contactIds: { $in: string[] } },
    update: Record<string, unknown>[],
  ): Promise<{ modifiedCount: number }>;
  countDocuments(filter: {
    status: "cancelled";
    cancelledAt: Date;
    contactIds: { $size: 0 };
  }): Promise<number>;
};

function asContactSendModel(model: object): ContactSendModel {
  return model as ContactSendModel;
}

async function pruneScheduledContacts(
  model: ContactSendModel,
  contactIds: string[],
  now: Date,
): Promise<{ updated: number; cancelled: number }> {
  if (contactIds.length === 0) return { updated: 0, cancelled: 0 };

  const result = await model.updateMany(
    { status: "scheduled", contactIds: { $in: contactIds } },
    [
      {
        $set: {
          contactIds: {
            $filter: {
              input: { $ifNull: ["$contactIds", []] },
              as: "id",
              cond: { $not: { $in: ["$$id", contactIds] } },
            },
          },
        },
      },
      {
        $set: {
          status: {
            $cond: [
              { $eq: [{ $size: { $ifNull: ["$contactIds", []] } }, 0] },
              "cancelled",
              "$status",
            ],
          },
          cancelledAt: {
            $cond: [
              { $eq: [{ $size: { $ifNull: ["$contactIds", []] } }, 0] },
              now,
              "$cancelledAt",
            ],
          },
        },
      },
    ],
  );

  const cancelled = await model.countDocuments({
    status: "cancelled",
    cancelledAt: now,
    contactIds: { $size: 0 },
  });

  return { updated: result.modifiedCount, cancelled };
}
