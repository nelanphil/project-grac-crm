import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { User, activeUserFilter } from "../models/mongo/User";
import {
  canonicalPhoneDigits,
  normalizePhoneDigits,
} from "./customerSites";
import { mintCheckoutKey } from "./checkoutKey";

export const EMAIL_CONFLICT_ADMIN =
  "A customer with this email already exists.";
export const EMAIL_CONFLICT_SIGNUP =
  "An account with this email already exists. Sign in or use Forgot password.";

export type EmailConflict =
  | { type: "user"; userId: Types.ObjectId }
  | { type: "customer"; customerId: Types.ObjectId };

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeAccountEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function accountEmailRegex(email: string): RegExp | null {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return null;
  return new RegExp(`^${escapeRegex(normalized)}$`, "i");
}

function toObjectId(id: Types.ObjectId | string): Types.ObjectId {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

function lastNameKey(last: string | null | undefined): string {
  return (last ?? "").trim().toLowerCase();
}

function usPhonePattern(digits: string): RegExp {
  return new RegExp(
    `(^|\\D)${digits.slice(0, 3)}\\D*${digits.slice(3, 6)}\\D*${digits.slice(6)}(\\D|$)`,
  );
}

/**
 * Active (not deleted/merged) customers that share a 10-digit phone and last
 * name. Used to attach portal logins to the existing CRM record instead of
 * creating an empty duplicate.
 */
export async function findActiveCustomersByPhoneAndLast(
  phone: string | null | undefined,
  lastName: string | null | undefined,
): Promise<Types.ObjectId[]> {
  const digits = canonicalPhoneDigits(phone);
  const last = lastNameKey(lastName);
  if (!digits || last.length < 2) return [];

  const lastRx = new RegExp(`^${escapeRegex(last)}$`, "i");
  const phoneRx = usPhonePattern(digits);
  const phoneVariants = [digits, `1${digits}`];

  const [byCustomer, byContact] = await Promise.all([
    Customer.find({
      last: lastRx,
      deletedAt: null,
      mergedIntoRef: null,
      $or: [
        { phoneDigits: { $in: phoneVariants } },
        { phone: phoneRx },
      ],
    })
      .select("_id")
      .lean(),
    CustomerContact.find({ last: lastRx, phone: phoneRx })
      .select("customerRef")
      .lean(),
  ]);

  const candidateIds = [
    ...byCustomer.map((c) => c._id as Types.ObjectId),
    ...byContact.map((c) => c.customerRef),
  ].filter((id): id is Types.ObjectId => Boolean(id));

  if (candidateIds.length === 0) return [];

  const unique = [
    ...new Map(candidateIds.map((id) => [String(id), id])).values(),
  ];
  const active = await Customer.find({
    _id: { $in: unique },
    deletedAt: null,
    mergedIntoRef: null,
  })
    .select("_id legacyId")
    .sort({ legacyId: 1 })
    .lean();
  return active.map((c) => c._id as Types.ObjectId);
}

async function nextCustomerLegacyId(): Promise<number> {
  const maxLegacy = await Customer.findOne()
    .sort({ legacyId: -1 })
    .select("legacyId")
    .lean();
  return (maxLegacy?.legacyId ?? 0) + 1;
}

/**
 * Treat an email as taken if it exists on an active User or as the
 * primary email on an active (not deleted/merged) Customer.
 * Secondary contact emails are not login identities.
 */
export async function findEmailConflict(
  email: string,
  opts?: {
    excludeUserId?: Types.ObjectId | string | null;
    excludeCustomerId?: Types.ObjectId | string | null;
    /** When rematching a primary email, an existing customer User is the login. */
    allowCustomerUser?: boolean;
  },
): Promise<EmailConflict | null> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) return null;

  const excludeUserId = opts?.excludeUserId
    ? toObjectId(opts.excludeUserId)
    : null;
  const excludeCustomerId = opts?.excludeCustomerId
    ? toObjectId(opts.excludeCustomerId)
    : null;

  const userQuery: Record<string, unknown> = {
    email: normalized,
    ...activeUserFilter,
  };
  if (excludeUserId) {
    userQuery._id = { $ne: excludeUserId };
  }
  const existingUser = await User.findOne(userQuery).select("_id role").lean();
  if (existingUser) {
    if (opts?.allowCustomerUser && existingUser.role === "customer") {
      // fall through to customer-primary check
    } else {
      return { type: "user", userId: existingUser._id as Types.ObjectId };
    }
  }

  const emailRx = accountEmailRegex(normalized);
  if (!emailRx) return null;

  const customerQuery: Record<string, unknown> = {
    email: emailRx,
    deletedAt: null,
    mergedIntoRef: null,
  };
  if (excludeCustomerId) {
    customerQuery._id = { $ne: excludeCustomerId };
  }
  const existingCustomer = await Customer.findOne(customerQuery)
    .select("_id")
    .lean();
  if (!existingCustomer) return null;

  return {
    type: "customer",
    customerId: existingCustomer._id as Types.ObjectId,
  };
}

/**
 * Create a minimal CRM Customer + primary Contact for an existing User.
 * Reuses an active customer whose primary email already matches the User.
 * Does not attach by phone + last name and does not write contact.userRef.
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
  const email = normalizeAccountEmail(user.email);
  const first = (user.first_name ?? "").trim() || "Customer";
  const last = (user.last_name ?? "").trim() || "User";
  const phone = (opts?.phone ?? user.phone ?? "").trim();
  const emailRx = accountEmailRegex(email);

  if (emailRx) {
    const existingCustomer = await Customer.findOne({
      email: emailRx,
      deletedAt: null,
      mergedIntoRef: null,
    })
      .select("_id")
      .sort({ legacyId: 1 })
      .lean();
    if (existingCustomer) {
      const primary =
        (await CustomerContact.findOne({
          customerRef: existingCustomer._id,
          isPrimary: true,
        })
          .select("_id")
          .lean()) ??
        (await CustomerContact.findOne({ customerRef: existingCustomer._id })
          .sort({ createdAt: 1 })
          .select("_id")
          .lean());
      if (primary) {
        return {
          customerId: existingCustomer._id as Types.ObjectId,
          contactId: primary._id as Types.ObjectId,
          created: false,
        };
      }
      const contact = await CustomerContact.create({
        customerRef: existingCustomer._id,
        first,
        last,
        phone,
        email,
        label: "Primary",
        isPrimary: true,
      });
      return {
        customerId: existingCustomer._id as Types.ObjectId,
        contactId: contact._id as Types.ObjectId,
        created: false,
      };
    }
  }

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
    checkoutKey: mintCheckoutKey(),
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
