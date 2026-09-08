import { Types } from "mongoose";
import { Customer, ICustomer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { User } from "../models/mongo/User";
import {
  accountEmailRegex,
  findActiveCustomersByPhoneAndLast,
} from "./provisionCustomerAccount";

/**
 * Portal / customer-scoped APIs resolve accounts only by
 * User.email === Customer.email (denormalized primary email).
 */
export async function resolveCustomerRefsForAuthUser(
  userId: string,
): Promise<Types.ObjectId[]> {
  if (!Types.ObjectId.isValid(userId)) return [];
  const user = await User.findById(userId).select("email").lean();
  const emailRx = accountEmailRegex(user?.email ?? "");
  if (!emailRx) return [];

  const customers = await Customer.find({
    email: emailRx,
    deletedAt: null,
    mergedIntoRef: null,
  })
    .select("_id")
    .lean();
  return customers.map((c) => c._id as Types.ObjectId);
}

/** Alias used by notification visibility. */
export async function resolveCustomerRefsForUser(
  userId: string,
): Promise<Types.ObjectId[]> {
  return resolveCustomerRefsForAuthUser(userId);
}

/**
 * All CRM accounts tied to this login: primary email, contact userRef/email,
 * and phone + last name. Checkout uses this so a linked record's balance is
 * not dropped when the login email sits on a different customer.
 */
export async function resolveLinkedCustomerRefsForAuthUser(
  userId: string,
): Promise<Types.ObjectId[]> {
  if (!Types.ObjectId.isValid(userId)) return [];
  const userObjectId = new Types.ObjectId(userId);
  const user = await User.findById(userObjectId)
    .select("email phone last_name")
    .lean();
  const emailRx = accountEmailRegex(user?.email ?? "");

  const [linkedContacts, emailContacts, emailCustomers] = await Promise.all([
    CustomerContact.find({ userRef: userObjectId, deletedAt: null })
      .select("customerRef phone last")
      .lean(),
    emailRx
      ? CustomerContact.find({ email: emailRx, deletedAt: null })
          .select("customerRef phone last")
          .lean()
      : Promise.resolve([]),
    emailRx
      ? Customer.find({
          email: emailRx,
          deletedAt: null,
          mergedIntoRef: null,
        })
          .select("_id")
          .lean()
      : Promise.resolve([]),
  ]);

  const lastName =
    (user?.last_name ?? "").trim() ||
    linkedContacts.find((c) => (c.last ?? "").trim())?.last ||
    emailContacts.find((c) => (c.last ?? "").trim())?.last ||
    "";
  const phones = [
    user?.phone,
    ...linkedContacts.map((c) => c.phone),
    ...emailContacts.map((c) => c.phone),
  ].filter((p): p is string => Boolean(p && p.trim()));
  const phoneMatches = (
    await Promise.all(
      [...new Set(phones)].map((phone) =>
        findActiveCustomersByPhoneAndLast(phone, lastName),
      ),
    )
  ).flat();

  const candidateIds = [
    ...linkedContacts.map((c) => c.customerRef),
    ...emailContacts.map((c) => c.customerRef),
    ...emailCustomers.map((c) => c._id as Types.ObjectId),
    ...phoneMatches,
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
    .select("_id")
    .lean();
  return active.map((c) => c._id as Types.ObjectId);
}

export async function resolveCheckoutCustomersForAuthUser(userId: string): Promise<{
  refs: Types.ObjectId[];
  preferredCustomerId?: string;
}> {
  const linkedRefs = await resolveLinkedCustomerRefsForAuthUser(userId);
  const refs =
    linkedRefs.length > 0
      ? linkedRefs
      : (await resolvePrimaryCustomerForAuthUser(userId)).refs;
  if (refs.length === 0) return { refs };

  const customers = await Customer.find({
    _id: { $in: refs },
    deletedAt: null,
    mergedIntoRef: null,
  })
    .select("_id legacyId")
    .sort({ legacyId: 1 })
    .lean();
  const siteOwnerIds = await CustomerAddress.distinct("customerRef", {
    customerRef: { $in: refs },
  });
  const siteSet = new Set(siteOwnerIds.map((id) => String(id)));
  const preferred =
    customers.find((row) => siteSet.has(String(row._id))) ?? customers[0];

  return {
    refs,
    preferredCustomerId: preferred ? String(preferred._id) : undefined,
  };
}

/** Prefer the linked customer that already has a site; else the oldest legacy record. */
export async function resolvePrimaryCustomerForAuthUser(userId: string): Promise<{
  refs: Types.ObjectId[];
  customer: ICustomer | null;
}> {
  const refs = await resolveCustomerRefsForAuthUser(userId);
  if (refs.length === 0) return { refs, customer: null };

  const linked = await Customer.find({
    _id: { $in: refs },
    deletedAt: null,
    mergedIntoRef: null,
  })
    .select("_id legacyId")
    .sort({ legacyId: 1 })
    .lean();
  if (linked.length === 0) return { refs, customer: null };

  const siteOwnerIds = await CustomerAddress.distinct("customerRef", {
    customerRef: { $in: refs },
  });
  const siteSet = new Set(siteOwnerIds.map((id) => String(id)));
  const preferred =
    linked.find((row) => siteSet.has(String(row._id))) ?? linked[0];
  const customer = await Customer.findById(preferred._id);
  return { refs, customer };
}

export async function findPrimaryContactForUserEmail(
  userEmail: string | null | undefined,
) {
  const emailRx = accountEmailRegex(userEmail ?? "");
  if (!emailRx) return null;

  const customer = await Customer.findOne({
    email: emailRx,
    deletedAt: null,
    mergedIntoRef: null,
  })
    .select("_id")
    .sort({ legacyId: 1 })
    .lean();
  if (!customer) return null;

  const primary = await CustomerContact.findOne({
    customerRef: customer._id,
    isPrimary: true,
    deletedAt: null,
  }).sort({ createdAt: 1 });
  if (primary) return primary;

  return CustomerContact.findOne({
    customerRef: customer._id,
    deletedAt: null,
  }).sort({
    createdAt: 1,
  });
}
