import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { CustomerNote } from "../models/mongo/CustomerNote";
import { EmailAccount } from "../models/mongo/EmailAccount";
import { MessageThread } from "../models/mongo/MessageThread";
import { normalizeAccountEmail } from "../utils/provisionCustomerAccount";
import { unreadTextQuery } from "../utils/unreadMessageThread";
import { hasUnseenInboxFrom } from "./mailbox.service";

const MAX_ADDRESSES = 15;

export type CustomerAttention = {
  unviewedNotes: boolean;
  unreadCommunications: boolean;
};

async function customerEmailAddresses(
  customerId: Types.ObjectId,
): Promise<string[]> {
  const [customer, contacts] = await Promise.all([
    Customer.findById(customerId).select("email").lean(),
    CustomerContact.find({
      customerRef: customerId,
      ...activeContactFilter,
    })
      .select("email")
      .lean(),
  ]);

  const emails = new Set<string>();
  const add = (value: string | null | undefined) => {
    const email = normalizeAccountEmail(value ?? "");
    if (email) emails.add(email);
  };
  add(customer?.email);
  for (const contact of contacts) add(contact.email);
  return [...emails].slice(0, MAX_ADDRESSES);
}

async function customerHasUnseenEmail(
  customerId: Types.ObjectId,
): Promise<boolean> {
  const addresses = await customerEmailAddresses(customerId);
  if (addresses.length === 0) return false;

  const accounts = await EmailAccount.find({
    isActive: true,
    imapHost: { $gt: "" },
  });
  if (accounts.length === 0) return false;

  const checks = await Promise.all(
    accounts.map(async (account) => {
      try {
        return await hasUnseenInboxFrom(account, addresses);
      } catch (err) {
        console.error(
          "[attention] unseen email check failed",
          String(account._id),
          err instanceof Error ? err.message : err,
        );
        return false;
      }
    }),
  );
  return checks.some(Boolean);
}

export async function loadCustomerAttention(
  customerId: Types.ObjectId,
  options: { includeCommunications: boolean },
): Promise<CustomerAttention> {
  const unviewedNotes = Boolean(
    await CustomerNote.exists({
      customerRef: customerId,
      viewedAt: { $type: "null" },
    }),
  );

  if (!options.includeCommunications) {
    return { unviewedNotes, unreadCommunications: false };
  }

  const [unreadText, unreadEmail] = await Promise.all([
    MessageThread.exists({
      customerRef: customerId,
      ...unreadTextQuery(),
    }),
    customerHasUnseenEmail(customerId),
  ]);

  return {
    unviewedNotes,
    unreadCommunications: Boolean(unreadText) || unreadEmail,
  };
}
