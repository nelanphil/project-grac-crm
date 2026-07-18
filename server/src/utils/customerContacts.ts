import { Types } from "mongoose";
import { Customer, ICustomer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";

export function customerHasContactData(customer: {
  first?: string;
  last?: string;
  phone?: string;
  email?: string;
}): boolean {
  return Boolean(
    customer.first?.trim() ||
      customer.last?.trim() ||
      customer.phone?.trim() ||
      customer.email?.trim()
  );
}

/** Refresh denormalized primary contact fields on the customer. */
export async function syncCustomerPrimaryContactFields(
  customerId: Types.ObjectId | string
): Promise<void> {
  const primaryContact = await CustomerContact.findOne({
    customerRef: customerId,
    isPrimary: true,
  }).lean();

  const contact =
    primaryContact ??
    (await CustomerContact.findOne({ customerRef: customerId })
      .sort({ createdAt: 1 })
      .lean());

  if (!contact) {
    await Customer.findByIdAndUpdate(customerId, {
      $set: {
        first: "",
        last: "",
        phone: "",
        email: "",
      },
    });
    return;
  }

  if (!contact.isPrimary) {
    await CustomerContact.updateOne(
      { _id: contact._id },
      { $set: { isPrimary: true } }
    );
  }

  await Customer.findByIdAndUpdate(customerId, {
    $set: {
      first: contact.first ?? "",
      last: contact.last ?? "",
      phone: contact.phone ?? "",
      email: contact.email ?? "",
    },
  });
}

/**
 * Ensure a customer has at least one contact from flat identity fields.
 * Used by migration and merge for pre-migration customers.
 */
export async function ensureCustomerContactFromFlat(
  customer: Pick<
    ICustomer,
    "_id" | "legacyId" | "first" | "last" | "phone" | "email"
  >
): Promise<{ contactId: Types.ObjectId; created: boolean }> {
  const existing = await CustomerContact.findOne({
    customerRef: customer._id,
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  if (existing) {
    return { contactId: existing._id as Types.ObjectId, created: false };
  }

  const contactDoc = await CustomerContact.create({
    customerRef: customer._id,
    first: customer.first ?? "",
    last: customer.last ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    label: "",
    isPrimary: true,
    legacyCustomerId: customer.legacyId ?? null,
  });

  return { contactId: contactDoc._id as Types.ObjectId, created: true };
}
