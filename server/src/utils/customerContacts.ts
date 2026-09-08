import { Types } from "mongoose";
import { Customer, ICustomer } from "../models/mongo/Customer";
import {
  activeContactFilter,
  CustomerContact,
  ICustomerContact,
} from "../models/mongo/CustomerContact";
import { ensureCustomerLoginForPrimaryEmail } from "./ensureCustomerLogin";
import { normalizePhoneDigits } from "./customerSites";

export class LastContactError extends Error {
  constructor() {
    super("Cannot delete the last contact on a customer.");
    this.name = "LastContactError";
  }
}

const HOMEOWNER_LABEL_RE = /^\s*home\s*owner\s*$/i;

export function isHomeownerLabel(label: string | null | undefined): boolean {
  return HOMEOWNER_LABEL_RE.test(label ?? "");
}

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
    customer.email?.trim(),
  );
}

export async function clearOtherPrimaryContacts(
  customerId: Types.ObjectId | string,
  keepContactId?: Types.ObjectId,
): Promise<void> {
  const filter: Record<string, unknown> = {
    customerRef: customerId,
    ...activeContactFilter,
  };
  if (keepContactId) {
    filter._id = { $ne: keepContactId };
  }
  await CustomerContact.updateMany(filter, { $set: { isPrimary: false } });
}

export async function clearOtherHomeownerLabels(
  customerId: Types.ObjectId | string,
  keepContactId?: Types.ObjectId,
): Promise<void> {
  const filter: Record<string, unknown> = {
    customerRef: customerId,
    ...activeContactFilter,
    label: { $regex: HOMEOWNER_LABEL_RE },
  };
  if (keepContactId) {
    filter._id = { $ne: keepContactId };
  }
  await CustomerContact.updateMany(filter, { $set: { label: "" } });
}

/** Apply exclusive primary on a contact document. Unchecking the only contact is a no-op. */
export async function applyContactPrimaryFlag(
  customerId: Types.ObjectId | string,
  contact: { _id: Types.ObjectId; isPrimary: boolean },
  requested: boolean | undefined,
): Promise<void> {
  if (requested === true) {
    await clearOtherPrimaryContacts(customerId, contact._id);
    contact.isPrimary = true;
    return;
  }
  if (requested !== false || !contact.isPrimary) return;

  const others = await CustomerContact.countDocuments({
    customerRef: customerId,
    _id: { $ne: contact._id },
    ...activeContactFilter,
  });
  if (others === 0) {
    contact.isPrimary = true;
    return;
  }

  contact.isPrimary = false;
  const next = await CustomerContact.findOne({
    customerRef: customerId,
    _id: { $ne: contact._id },
    ...activeContactFilter,
  }).sort({ createdAt: 1 });
  if (next) {
    next.isPrimary = true;
    await next.save();
  }
}

/** Refresh denormalized primary contact fields on the customer. */
export async function syncCustomerPrimaryContactFields(
  customerId: Types.ObjectId | string,
): Promise<void> {
  const primaryContact = await CustomerContact.findOne({
    customerRef: customerId,
    isPrimary: true,
    ...activeContactFilter,
  }).lean();

  const contact =
    primaryContact ??
    (await CustomerContact.findOne({
      customerRef: customerId,
      ...activeContactFilter,
    })
      .sort({ createdAt: 1 })
      .lean());

  if (!contact) {
    await Customer.findByIdAndUpdate(customerId, {
      $set: {
        first: "",
        last: "",
        phone: "",
        phoneDigits: "",
        email: "",
      },
    });
    return;
  }

  if (!contact.isPrimary) {
    await CustomerContact.updateOne(
      { _id: contact._id },
      { $set: { isPrimary: true } },
    );
  }

  await Customer.findByIdAndUpdate(customerId, {
    $set: {
      first: contact.first ?? "",
      last: contact.last ?? "",
      phone: contact.phone ?? "",
      phoneDigits: normalizePhoneDigits(contact.phone),
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
  >,
): Promise<{ contactId: Types.ObjectId; created: boolean }> {
  const existing = await CustomerContact.findOne({
    customerRef: customer._id,
    ...activeContactFilter,
  })
    .sort({ isPrimary: -1, createdAt: 1 })
    .lean();

  if (existing) {
    await ensureCustomerLoginForPrimaryEmail(customer._id);
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

  await ensureCustomerLoginForPrimaryEmail(customer._id);

  return { contactId: contactDoc._id as Types.ObjectId, created: true };
}

/** Soft-delete a contact. Refuses if it is the last active contact. */
export async function softDeleteCustomerContact(
  contact: ICustomerContact,
): Promise<{ wasPrimary: boolean }> {
  if (contact.deletedAt) {
    return { wasPrimary: false };
  }

  const total = await CustomerContact.countDocuments({
    customerRef: contact.customerRef,
    ...activeContactFilter,
  });
  if (total <= 1) {
    throw new LastContactError();
  }

  const wasPrimary = contact.isPrimary;
  contact.deletedAt = new Date();
  contact.isPrimary = false;
  await contact.save();

  if (wasPrimary) {
    const next = await CustomerContact.findOne({
      customerRef: contact.customerRef,
      ...activeContactFilter,
    }).sort({ createdAt: 1 });
    if (next) {
      next.isPrimary = true;
      await next.save();
    }
  }

  await syncCustomerPrimaryContactFields(contact.customerRef);
  return { wasPrimary };
}
