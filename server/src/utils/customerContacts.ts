import { Types } from "mongoose";
import { Customer, ICustomer } from "../models/mongo/Customer";
import {
  activeContactFilter,
  CustomerContact,
  ICustomerContact,
} from "../models/mongo/CustomerContact";
import { ensureCustomerLoginForPrimaryEmail } from "./ensureCustomerLogin";
import { normalizePhoneDigits } from "./customerSites";
import { accountNameFromPerson } from "./vacantCustomer";

export function contactDisplayName(contact: {
  first?: string | null;
  last?: string | null;
  phone?: string | null;
}): string {
  return (
    `${contact.first ?? ""} ${contact.last ?? ""}`.trim() ||
    (contact.phone ?? "").trim() ||
    "Contact"
  );
}

/** Names for message and call rows, including people no longer on the property. */
export async function loadContactDisplayNames(
  ids: Array<unknown>,
): Promise<Map<string, string>> {
  const unique = [
    ...new Set(
      ids
        .map((id) => (id == null ? "" : String(id)))
        .filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  if (unique.length === 0) return new Map();
  const contacts = await CustomerContact.find({ _id: { $in: unique } })
    .select("first last phone")
    .lean();
  return new Map(
    contacts.map((contact) => [
      String(contact._id),
      contactDisplayName(contact),
    ]),
  );
}

/** Drop a person from the previous-contact list once they are on the property again. */
export async function forgetFormerContact(
  customerId: Types.ObjectId | string,
  contactId: Types.ObjectId | string,
): Promise<void> {
  if (
    !Types.ObjectId.isValid(String(customerId)) ||
    !Types.ObjectId.isValid(String(contactId))
  ) {
    return;
  }
  await Customer.updateOne(
    { _id: customerId },
    { $pull: { formerContactRefs: contactId } },
  );
}

export function lastContactBlock(
  activeCount: number,
  action: "delete" | "detach",
): string | null {
  if (activeCount > 1) return null;
  return action === "detach"
    ? "A customer must keep at least one contact."
    : "Cannot delete the last contact on a customer.";
}

export class LastContactError extends Error {
  constructor(message = "Cannot delete the last contact on a customer.") {
    super(message);
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

/**
 * When the first contact is added to a property still named Vacant, the
 * customer name becomes that person's name.
 */
export async function renameVacantAccountForFirstContact(
  customerId: Types.ObjectId | string,
  person: { first?: string | null; last?: string | null },
): Promise<string | null> {
  const nextName = accountNameFromPerson(person.first, person.last);
  if (!nextName) return null;
  const updated = await Customer.findOneAndUpdate(
    { _id: customerId, accountName: { $regex: /^vacant$/i } },
    { $set: { accountName: nextName } },
  ).lean();
  return updated ? nextName : null;
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

/** Soft-delete a contact. Refuses if it is the last active contact on a customer. */
export async function softDeleteCustomerContact(
  contact: ICustomerContact,
): Promise<{ wasPrimary: boolean }> {
  if (contact.deletedAt) {
    return { wasPrimary: false };
  }

  if (contact.customerRef) {
    const total = await CustomerContact.countDocuments({
      customerRef: contact.customerRef,
      ...activeContactFilter,
    });
    if (total <= 1) {
      throw new LastContactError(lastContactBlock(total, "delete") ?? undefined);
    }
  }

  const wasPrimary = contact.isPrimary;
  contact.deletedAt = new Date();
  contact.isPrimary = false;
  await contact.save();

  if (wasPrimary && contact.customerRef) {
    const next = await CustomerContact.findOne({
      customerRef: contact.customerRef,
      ...activeContactFilter,
    }).sort({ createdAt: 1 });
    if (next) {
      next.isPrimary = true;
      await next.save();
    }
  }

  if (contact.customerRef) {
    await syncCustomerPrimaryContactFields(contact.customerRef);
  }
  return { wasPrimary };
}

/**
 * Take a contact off its customer without deleting it.
 * A customer must keep at least one contact.
 */
export async function detachCustomerContact(
  contact: ICustomerContact,
): Promise<{ wasPrimary: boolean; previousCustomerId: Types.ObjectId | null }> {
  const previousCustomerId = contact.customerRef;
  if (!previousCustomerId || contact.deletedAt) {
    return { wasPrimary: false, previousCustomerId: null };
  }

  const total = await CustomerContact.countDocuments({
    customerRef: previousCustomerId,
    ...activeContactFilter,
  });
  if (total <= 1) {
    throw new LastContactError(
      lastContactBlock(total, "detach") ?? "A customer must keep at least one contact.",
    );
  }

  const wasPrimary = contact.isPrimary;
  contact.customerRef = null;
  contact.isPrimary = false;
  await contact.save();

  if (wasPrimary) {
    const next = await CustomerContact.findOne({
      customerRef: previousCustomerId,
      ...activeContactFilter,
    }).sort({ createdAt: 1 });
    if (next) {
      next.isPrimary = true;
      await next.save();
    }
  }

  await syncCustomerPrimaryContactFields(previousCustomerId);
  return { wasPrimary, previousCustomerId };
}
