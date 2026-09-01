import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { User, activeUserFilter } from "../models/mongo/User";
import { normalizePhoneDigits } from "./customerSites";

export const EMAIL_CONFLICT_ADMIN =
  "A customer with this email already exists.";
export const EMAIL_CONFLICT_SIGNUP =
  "An account with this email already exists. Sign in or use Forgot password.";

export type EmailConflict =
  | { type: "user"; userId: Types.ObjectId }
  | { type: "contact"; contactId: Types.ObjectId; customerId: Types.ObjectId };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toObjectId(id: Types.ObjectId | string): Types.ObjectId {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

async function nextCustomerLegacyId(): Promise<number> {
  const maxLegacy = await Customer.findOne()
    .sort({ legacyId: -1 })
    .select("legacyId")
    .lean();
  return (maxLegacy?.legacyId ?? 0) + 1;
}

/**
 * Treat an email as taken if it exists on an active User or on a
 * CustomerContact whose customer is not deleted/merged.
 */
export async function findEmailConflict(
  email: string,
  opts?: {
    excludeUserId?: Types.ObjectId | string | null;
    excludeContactId?: Types.ObjectId | string | null;
  },
): Promise<EmailConflict | null> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return null;

  const excludeUserId = opts?.excludeUserId
    ? toObjectId(opts.excludeUserId)
    : null;
  const excludeContactId = opts?.excludeContactId
    ? toObjectId(opts.excludeContactId)
    : null;

  const userQuery: Record<string, unknown> = {
    email: normalized,
    ...activeUserFilter,
  };
  if (excludeUserId) {
    userQuery._id = { $ne: excludeUserId };
  }
  const existingUser = await User.findOne(userQuery).select("_id").lean();
  if (existingUser) {
    return { type: "user", userId: existingUser._id as Types.ObjectId };
  }

  const emailRx = new RegExp(`^${escapeRegex(normalized)}$`, "i");
  const contactQuery: Record<string, unknown> = { email: emailRx };
  if (excludeContactId) {
    contactQuery._id = { $ne: excludeContactId };
  }
  if (excludeUserId) {
    contactQuery.userRef = { $ne: excludeUserId };
  }

  const contacts = await CustomerContact.find(contactQuery)
    .select("_id customerRef")
    .lean();
  if (contacts.length === 0) return null;

  const customerIds = contacts.map((c) => c.customerRef);
  const activeCustomers = await Customer.find({
    _id: { $in: customerIds },
    deletedAt: null,
    mergedIntoRef: null,
  })
    .select("_id")
    .lean();
  const activeIds = new Set(activeCustomers.map((c) => String(c._id)));
  const match = contacts.find((c) => activeIds.has(String(c.customerRef)));
  if (!match) return null;

  return {
    type: "contact",
    contactId: match._id as Types.ObjectId,
    customerId: match.customerRef as Types.ObjectId,
  };
}

/**
 * Create a minimal CRM Customer + primary Contact linked to an existing User.
 * Skips if the user already has a linked contact. Does not call ensureCustomerUser.
 */
export async function provisionCrmCustomerForUser(
  user: {
    _id: Types.ObjectId | string;
    email: string;
    first_name: string;
    last_name: string;
    phone?: string | null;
  },
  opts?: { phone?: string | null },
): Promise<{
  customerId: Types.ObjectId;
  contactId: Types.ObjectId;
  created: boolean;
}> {
  const userId = toObjectId(user._id);
  const existing = await CustomerContact.findOne({ userRef: userId })
    .select("_id customerRef")
    .lean();
  if (existing) {
    return {
      customerId: existing.customerRef as Types.ObjectId,
      contactId: existing._id as Types.ObjectId,
      created: false,
    };
  }

  const email = normalizeAccountEmail(user.email);
  const first = (user.first_name ?? "").trim() || "Customer";
  const last = (user.last_name ?? "").trim() || "User";
  const phone = (opts?.phone ?? user.phone ?? "").trim();
  const accountName = `${first} ${last}`.trim();
  const legacyId = await nextCustomerLegacyId();

  const customer = await Customer.create({
    legacyId,
    userId: 0,
    accountName,
    first,
    last,
    phone,
    phoneDigits: normalizePhoneDigits(phone),
    email,
    address: "",
    city: "",
    state: "",
    zip: "",
    county: "",
    ownerUserRef: null,
    deletedAt: null,
    mergedIntoRef: null,
    mergedAt: null,
    isTemporary: false,
  });

  try {
    const contact = await CustomerContact.create({
      customerRef: customer._id,
      first,
      last,
      phone,
      email,
      label: "Primary",
      isPrimary: true,
      userRef: userId,
      legacyCustomerId: legacyId,
    });
    return {
      customerId: customer._id as Types.ObjectId,
      contactId: contact._id as Types.ObjectId,
      created: true,
    };
  } catch (err) {
    await Customer.deleteOne({ _id: customer._id });
    throw err;
  }
}
