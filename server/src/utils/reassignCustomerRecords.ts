import mongoose from "mongoose";
import { Contract } from "../models/mongo/Contract";
import { DiscountRedemption } from "../models/mongo/DiscountRedemption";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { Estimate } from "../models/mongo/Estimate";
import { Invoice } from "../models/mongo/Invoice";
import { Lead } from "../models/mongo/Lead";
import { MessageThread } from "../models/mongo/MessageThread";
import { NotificationEvent } from "../models/mongo/NotificationEvent";
import { SmsMessage } from "../models/mongo/SmsMessage";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { VoiceIvrSession } from "../models/mongo/VoiceIvrSession";
import { WorkOrder } from "../models/mongo/WorkOrder";

type LegacyModel = {
  updateMany: (
    filter: object,
    update: object,
  ) => Promise<{ modifiedCount?: number; matchedCount?: number }>;
};

export function customerOwnedFilter(
  customerId: mongoose.Types.ObjectId,
  legacyId?: number | null,
): { $or: Array<Record<string, unknown>> } {
  const or: Array<Record<string, unknown>> = [{ customerRef: customerId }];
  if (typeof legacyId === "number") {
    or.push({ customerId: legacyId });
  }
  return { $or: or };
}

export type ReassignedCustomerCounts = {
  invoices: number;
  estimates: number;
  workOrders: number;
  contracts: number;
  leads: number;
  messageThreads: number;
  emailCommunications: number;
  twilioCommunications: number;
  smsMessages: number;
  discountRedemptions: number;
  notificationEvents: number;
  voiceIvrSessions: number;
};

async function remappedCount(
  model: LegacyModel,
  filter: object,
  update: object,
): Promise<number> {
  const result = await model.updateMany(filter, update);
  return result.modifiedCount ?? result.matchedCount ?? 0;
}

/**
 * Move invoices, tickets, and other customer-owned records from a merged-away
 * source onto the surviving customer. Addresses, contacts, equipment, and notes
 * are handled separately by merge (they have extra primary-flag logic).
 */
export async function reassignCustomerOwnedRecords(opts: {
  sourceId: mongoose.Types.ObjectId;
  sourceLegacyId?: number | null;
  survivorId: mongoose.Types.ObjectId;
  survivorLegacyId?: number | null;
}): Promise<ReassignedCustomerCounts> {
  const owned = customerOwnedFilter(opts.sourceId, opts.sourceLegacyId);
  const byRef = { customerRef: opts.sourceId };
  const ticketSet: Record<string, unknown> = {
    customerRef: opts.survivorId,
  };
  if (typeof opts.survivorLegacyId === "number") {
    ticketSet.customerId = opts.survivorLegacyId;
  }
  const refSet = { customerRef: opts.survivorId };

  const [
    invoices,
    estimates,
    workOrders,
    contracts,
    leads,
    messageThreads,
    emailCommunications,
    twilioCommunications,
    smsMessages,
    discountRedemptions,
    notificationEvents,
    voiceIvrSessions,
  ] = await Promise.all([
    remappedCount(Invoice, owned, { $set: ticketSet }),
    remappedCount(Estimate, owned, { $set: ticketSet }),
    remappedCount(WorkOrder, owned, { $set: ticketSet }),
    remappedCount(Contract, owned, { $set: ticketSet }),
    remappedCount(Lead, byRef, { $set: refSet }),
    remappedCount(MessageThread, byRef, { $set: refSet }),
    remappedCount(EmailCommunication, byRef, { $set: refSet }),
    remappedCount(TwilioCommunication, byRef, { $set: refSet }),
    remappedCount(SmsMessage, byRef, { $set: refSet }),
    remappedCount(DiscountRedemption, byRef, { $set: refSet }),
    remappedCount(NotificationEvent, byRef, { $set: refSet }),
    remappedCount(VoiceIvrSession, byRef, { $set: refSet }),
  ]);

  return {
    invoices,
    estimates,
    workOrders,
    contracts,
    leads,
    messageThreads,
    emailCommunications,
    twilioCommunications,
    smsMessages,
    discountRedemptions,
    notificationEvents,
    voiceIvrSessions,
  };
}
