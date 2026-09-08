import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { User, activeUserFilter } from "../models/mongo/User";
import {
  accountEmailRegex,
  normalizeAccountEmail,
} from "./provisionCustomerAccount";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EnsureCustomerLoginResult =
  | { status: "skipped"; reason: "empty" | "invalid" | "staff-email" | "missing-customer" }
  | { status: "linked"; userId: Types.ObjectId }
  | { status: "renamed"; userId: Types.ObjectId }
  | { status: "restored"; userId: Types.ObjectId }
  | { status: "created"; userId: Types.ObjectId };

function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === 11000
  );
}

/**
 * Ensure exactly one customer User exists for this customer's primary email.
 * When the primary email changes, rename the previous customer User if the
 * new address is free. Never steals a staff account.
 */
export async function ensureCustomerLoginForPrimaryEmail(
  customerId: Types.ObjectId | string,
  opts?: { previousEmail?: string | null },
): Promise<EnsureCustomerLoginResult> {
  if (!Types.ObjectId.isValid(String(customerId))) {
    return { status: "skipped", reason: "missing-customer" };
  }

  const customer = await Customer.findById(customerId)
    .select("email first last")
    .lean();
  if (!customer) {
    return { status: "skipped", reason: "missing-customer" };
  }

  const email = normalizeAccountEmail(customer.email ?? "");
  if (!email) {
    return { status: "skipped", reason: "empty" };
  }
  if (!isValidEmail(email)) {
    return { status: "skipped", reason: "invalid" };
  }

  const first_name = (customer.first ?? "").trim() || "Customer";
  const last_name = (customer.last ?? "").trim() || "User";
  const previousEmail = normalizeAccountEmail(opts?.previousEmail ?? "");

  const active = await User.findOne({ email, ...activeUserFilter });
  if (active) {
    if (active.role !== "customer") {
      return { status: "skipped", reason: "staff-email" };
    }
    return { status: "linked", userId: active._id as Types.ObjectId };
  }

  if (previousEmail && previousEmail !== email) {
    const previous = await User.findOne({
      email: previousEmail,
      role: "customer",
      ...activeUserFilter,
    });
    if (previous) {
      previous.email = email;
      previous.first_name = first_name;
      previous.last_name = last_name;
      try {
        await previous.save();
        return { status: "renamed", userId: previous._id as Types.ObjectId };
      } catch (err) {
        if (!isDuplicateKeyError(err)) throw err;
      }
    }
  }

  const softDeleted = await User.findOne({
    email,
    deletedAt: { $ne: null },
  });
  if (softDeleted) {
    softDeleted.deletedAt = null;
    softDeleted.first_name = first_name;
    softDeleted.last_name = last_name;
    if (softDeleted.role !== "customer") {
      return { status: "skipped", reason: "staff-email" };
    }
    await softDeleted.save();
    return { status: "restored", userId: softDeleted._id as Types.ObjectId };
  }

  const password_hash = await bcrypt.hash(
    crypto.randomBytes(24).toString("base64url"),
    10,
  );

  try {
    const user = await User.create({
      email,
      password_hash,
      first_name,
      last_name,
      role: "customer",
    });
    return { status: "created", userId: user._id as Types.ObjectId };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;

    const existing = await User.findOne({ email });
    if (!existing) throw err;
    if (existing.role !== "customer") {
      return { status: "skipped", reason: "staff-email" };
    }

    if (existing.deletedAt) {
      existing.deletedAt = null;
      existing.first_name = first_name;
      existing.last_name = last_name;
      await existing.save();
      return { status: "restored", userId: existing._id as Types.ObjectId };
    }

    return { status: "linked", userId: existing._id as Types.ObjectId };
  }
}

/** After a customer User changes email, keep matching Customer + primary contact in sync. */
export async function syncCustomersToUserEmail(
  previousEmail: string,
  nextEmail: string,
): Promise<void> {
  const prevRx = accountEmailRegex(previousEmail);
  const next = normalizeAccountEmail(nextEmail);
  if (!prevRx || !next || !isValidEmail(next)) return;

  const customers = await Customer.find({
    email: prevRx,
    deletedAt: null,
    mergedIntoRef: null,
  }).select("_id");

  for (const customer of customers) {
    await Customer.updateOne({ _id: customer._id }, { $set: { email: next } });
    await CustomerContact.updateOne(
      { customerRef: customer._id, isPrimary: true },
      { $set: { email: next } },
    );
  }
}
