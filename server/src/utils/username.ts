import { Types } from "mongoose";
import { IUser, User } from "../models/mongo/User";

export const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,29}$/;

export function normalizeUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUsername(input: string): boolean {
  return USERNAME_REGEX.test(normalizeUsername(input));
}

/**
 * Extract the numeric suffix from usernameKey.
 * Original (non-dupe) keys equal the display username → null (no number).
 * Dupes: doc + doc1 → 1, doc + doc2 → 2.
 */
export function usernameNumberFromKey(
  username: string | null | undefined,
  usernameKey: string | null | undefined
): number | null {
  if (!username || !usernameKey) return null;
  if (usernameKey === username) return null;
  if (!usernameKey.startsWith(username)) return null;
  const suffix = usernameKey.slice(username.length);
  if (!/^\d+$/.test(suffix)) return null;
  const n = parseInt(suffix, 10);
  return Number.isNaN(n) ? null : n;
}

function desiredKeyForIndex(base: string, index: number): string {
  // index 0 = original (no number); 1 → base1; 2 → base2
  return index === 0 ? base : `${base}${index}`;
}

export type UsernamePreview = {
  valid: boolean;
  message?: string;
  username: string | null;
  usernameNumber: number | null;
  isShared: boolean;
  signInAs: string | null;
};

/**
 * Preview what usernameNumber / sign-in handle a user would get for a proposed
 * display username — without writing anything. Matches rebalance ordering
 * (oldest createdAt → bare key).
 */
export async function previewUsernameAssignment(
  proposed: string,
  viewer: { _id: Types.ObjectId | string; createdAt: Date }
): Promise<UsernamePreview> {
  const trimmed = proposed.trim();
  if (!trimmed) {
    return {
      valid: true,
      username: null,
      usernameNumber: null,
      isShared: false,
      signInAs: null,
      message: "Leave blank to clear your username.",
    };
  }

  const normalized = normalizeUsername(trimmed);
  if (!USERNAME_REGEX.test(normalized)) {
    return {
      valid: false,
      username: null,
      usernameNumber: null,
      isShared: false,
      signInAs: null,
      message:
        "Username must be 3–30 characters, start with a letter, and contain only letters, numbers, or underscores.",
    };
  }

  const others = await User.find({
    username: normalized,
    deletedAt: null,
    _id: { $ne: viewer._id },
  })
    .select("_id createdAt")
    .lean();

  const cohort = [
    ...others.map((o) => ({
      id: String(o._id),
      createdAt: new Date(o.createdAt).getTime(),
    })),
    {
      id: String(viewer._id),
      createdAt: new Date(viewer.createdAt).getTime(),
    },
  ].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });

  const index = cohort.findIndex((c) => c.id === String(viewer._id));
  const key = desiredKeyForIndex(normalized, Math.max(0, index));
  const usernameNumber = usernameNumberFromKey(normalized, key);
  const isShared = cohort.length > 1;

  return {
    valid: true,
    username: normalized,
    usernameNumber,
    isShared,
    signInAs: key,
    message: isShared
      ? usernameNumber != null
        ? "This username is already in use. You would sign in with your username plus number."
        : "This username is shared, but your account would keep the original (no number)."
      : "This username is available. You would sign in with just this name.",
  };
}

/**
 * Rebalance usernameKey for all active users sharing a display username.
 * Oldest account (by createdAt) gets the bare key; others get 1, 2, 3…
 * Uses a temp-key pass to avoid unique-index collisions.
 * Returns the key assigned to `focusUserId` (or the bare key if focus is not in the group).
 */
export async function rebalanceUsernameGroup(
  base: string,
  focusUserId: Types.ObjectId | string
): Promise<string> {
  const normalized = normalizeUsername(base);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Soft-deleted accounts must not keep unique keys that block active users
  await User.updateMany(
    {
      deletedAt: { $ne: null },
      $or: [
        { usernameKey: normalized },
        { usernameKey: { $regex: new RegExp(`^${escaped}\\d+$`) } },
      ],
    },
    { $set: { usernameKey: null } }
  );

  const group = await User.find({
    username: normalized,
    deletedAt: null,
  }).sort({ createdAt: 1 });

  if (group.length === 0) {
    return normalized;
  }

  const focusId = String(focusUserId);
  const assignments = group.map((doc, index) => ({
    doc,
    key: desiredKeyForIndex(normalized, index),
  }));

  // Phase 1 — move anyone who needs a new key onto a unique temp value
  for (const { doc, key } of assignments) {
    if (doc.usernameKey !== key) {
      doc.usernameKey = `__tmp_${String(doc._id)}`;
      await doc.save();
    }
  }

  // Phase 2 — assign final keys
  let focusKey = normalized;
  for (const { doc, key } of assignments) {
    doc.username = normalized;
    doc.usernameKey = key;
    await doc.save();
    if (String(doc._id) === focusId) {
      focusKey = key;
    }
  }

  return focusKey;
}

/**
 * Set or clear username + usernameKey on a user document.
 * Saves the user (and may rebalance peers that share the same display username).
 */
export async function applyUsername(
  user: IUser,
  base: string | null | undefined
): Promise<void> {
  if (base === null || base === undefined || base.trim() === "") {
    const previous = user.username;
    user.username = null;
    user.usernameKey = null;
    await user.save();

    // Peers that shared the old name may need keys rebalanced (sole → bare)
    if (previous) {
      const remaining = await User.find({
        username: previous,
        deletedAt: null,
      })
        .sort({ createdAt: 1 })
        .select("_id")
        .lean();
      if (remaining.length > 0) {
        await rebalanceUsernameGroup(
          previous,
          remaining[0]._id as Types.ObjectId
        );
      }
    }
    return;
  }

  const normalized = normalizeUsername(base);
  if (!USERNAME_REGEX.test(normalized)) {
    throw new Error(
      "Username must be 3–30 characters, start with a letter, and contain only letters, numbers, or underscores"
    );
  }

  user.username = normalized;
  // Persist username first so this user is included in the group query
  await user.save();

  await rebalanceUsernameGroup(normalized, user._id as Types.ObjectId);

  // Rebalance saves via other document instances — refresh this one so a
  // later caller save() cannot overwrite with a stale usernameKey / __v.
  const fresh = await User.findById(user._id);
  if (!fresh) {
    throw new Error("User not found after username update");
  }
  user.username = fresh.username;
  user.usernameKey = fresh.usernameKey;
  const freshVersion = fresh.get("__v");
  if (typeof freshVersion === "number") {
    user.set("__v", freshVersion);
  }
}
