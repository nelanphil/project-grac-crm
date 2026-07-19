import crypto from "crypto";
import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { User, activeUserFilter } from "../models/mongo/User";
import { CustomerContact } from "../models/mongo/CustomerContact";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EnsureCustomerUserResult =
  | { status: "skipped"; reason: "empty" | "invalid" }
  | { status: "linked"; userId: Types.ObjectId }
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

async function linkContact(
  contactId: Types.ObjectId,
  userId: Types.ObjectId,
  currentRef?: Types.ObjectId | null
): Promise<void> {
  if (currentRef && String(currentRef) === String(userId)) return;
  await CustomerContact.updateOne(
    { _id: contactId },
    { $set: { userRef: userId } }
  );
}

/**
 * Ensure a CustomerContact with a valid email has a linked User.
 * - Existing active user → link only (never change role/password)
 * - Soft-deleted user → restore + refresh name, keep role
 * - No user → create with role "customer" and random temp password
 * Duplicate emails across contacts (or concurrent creates) link to the same user.
 */
export async function ensureCustomerUser(contact: {
  _id: Types.ObjectId;
  email?: string | null;
  first?: string | null;
  last?: string | null;
  userRef?: Types.ObjectId | null;
}): Promise<EnsureCustomerUserResult> {
  const email = (contact.email ?? "").trim().toLowerCase();
  if (!email) {
    return { status: "skipped", reason: "empty" };
  }
  if (!isValidEmail(email)) {
    return { status: "skipped", reason: "invalid" };
  }

  const first_name = (contact.first ?? "").trim() || "Customer";
  const last_name = (contact.last ?? "").trim() || "User";

  const active = await User.findOne({ email, ...activeUserFilter });
  if (active) {
    await linkContact(
      contact._id,
      active._id as Types.ObjectId,
      contact.userRef
    );
    return { status: "linked", userId: active._id as Types.ObjectId };
  }

  const softDeleted = await User.findOne({
    email,
    deletedAt: { $ne: null },
  });
  if (softDeleted) {
    softDeleted.deletedAt = null;
    softDeleted.first_name = first_name;
    softDeleted.last_name = last_name;
    await softDeleted.save();
    await linkContact(
      contact._id,
      softDeleted._id as Types.ObjectId,
      contact.userRef
    );
    return { status: "restored", userId: softDeleted._id as Types.ObjectId };
  }

  const password_hash = await bcrypt.hash(
    crypto.randomBytes(24).toString("base64url"),
    10
  );

  try {
    const user = await User.create({
      email,
      password_hash,
      first_name,
      last_name,
      role: "customer",
    });

    await linkContact(
      contact._id,
      user._id as Types.ObjectId,
      contact.userRef
    );
    return { status: "created", userId: user._id as Types.ObjectId };
  } catch (err) {
    // Concurrent create for the same email — link to the winner
    if (!isDuplicateKeyError(err)) throw err;

    const existing = await User.findOne({ email });
    if (!existing) throw err;

    if (existing.deletedAt) {
      existing.deletedAt = null;
      existing.first_name = first_name;
      existing.last_name = last_name;
      await existing.save();
      await linkContact(
        contact._id,
        existing._id as Types.ObjectId,
        contact.userRef
      );
      return { status: "restored", userId: existing._id as Types.ObjectId };
    }

    await linkContact(
      contact._id,
      existing._id as Types.ObjectId,
      contact.userRef
    );
    return { status: "linked", userId: existing._id as Types.ObjectId };
  }
}
