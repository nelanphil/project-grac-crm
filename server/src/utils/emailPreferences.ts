import { Types } from "mongoose";
import {
  EmailPreference,
  type EmailUnsubscribeSource,
} from "../models/mongo/EmailPreference";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { normalizeAccountEmail } from "./provisionCustomerAccount";
import type { EmailPrefChannel } from "./unsubscribeToken";

export interface EmailPreferenceValues {
  email: string;
  generalNotifications: boolean;
  billingAlerts: boolean;
  unsubscribedAt: Date | null;
  unsubscribeSource: EmailUnsubscribeSource | "";
}

export const DEFAULT_EMAIL_PREFERENCES = {
  generalNotifications: true,
  billingAlerts: true,
  unsubscribedAt: null,
  unsubscribeSource: "",
} as const;

export async function getEmailPreferences(
  email: string,
): Promise<EmailPreferenceValues> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) {
    return { email: "", ...DEFAULT_EMAIL_PREFERENCES };
  }
  const row = await EmailPreference.findOne({ email: normalized }).lean();
  if (!row) {
    return { email: normalized, ...DEFAULT_EMAIL_PREFERENCES };
  }
  return {
    email: normalized,
    generalNotifications: row.generalNotifications !== false,
    billingAlerts: row.billingAlerts !== false,
    unsubscribedAt: row.unsubscribedAt ?? null,
    unsubscribeSource: row.unsubscribeSource || "",
  };
}

export async function setEmailPreferences(
  email: string,
  patch: {
    generalNotifications?: boolean;
    billingAlerts?: boolean;
  },
  meta?: { source?: EmailUnsubscribeSource },
): Promise<EmailPreferenceValues> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) {
    throw new Error("Email is required");
  }

  const current = await getEmailPreferences(normalized);
  const next = {
    generalNotifications:
      patch.generalNotifications ?? current.generalNotifications,
    billingAlerts: patch.billingAlerts ?? current.billingAlerts,
  };
  const turnedOff =
    (current.generalNotifications && !next.generalNotifications) ||
    (current.billingAlerts && !next.billingAlerts);
  const bothOn = next.generalNotifications && next.billingAlerts;
  const update: Record<string, unknown> = {
    email: normalized,
    ...next,
  };
  if (turnedOff) {
    update.unsubscribedAt = new Date();
    update.unsubscribeSource = meta?.source || "";
  } else if (bothOn) {
    update.unsubscribedAt = null;
    update.unsubscribeSource = "";
  }

  const row = await EmailPreference.findOneAndUpdate(
    { email: normalized },
    { $set: update },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return {
    email: normalized,
    generalNotifications: row?.generalNotifications !== false,
    billingAlerts: row?.billingAlerts !== false,
    unsubscribedAt: row?.unsubscribedAt ?? null,
    unsubscribeSource: row?.unsubscribeSource || "",
  };
}

/** Addresses whose general (non-billing) notifications are off. */
export async function emailOptedOut(emails: string[]): Promise<Set<string>> {
  const normalized = [
    ...new Set(emails.map((email) => normalizeAccountEmail(email)).filter(Boolean)),
  ];
  if (normalized.length === 0) return new Set();
  const rows = await EmailPreference.find({
    email: { $in: normalized },
    generalNotifications: false,
  })
    .select("email")
    .lean();
  return new Set(rows.map((row) => row.email));
}

export async function partitionContactsByEmailOptOut(
  contactIds: string[],
): Promise<{ allowed: string[]; skipped: string[] }> {
  const valid = contactIds.filter((id) => Types.ObjectId.isValid(id));
  const contacts = valid.length
    ? await CustomerContact.find({ _id: { $in: valid } })
        .select("_id email")
        .lean()
    : [];
  const emailById = new Map(
    contacts.map((contact) => [String(contact._id), contact.email ?? ""]),
  );
  const opted = await emailOptedOut([...emailById.values()]);
  const allowed: string[] = [];
  const skipped: string[] = [];
  for (const id of contactIds) {
    const email = normalizeAccountEmail(emailById.get(id) ?? "");
    if (email && opted.has(email)) skipped.push(id);
    else allowed.push(id);
  }
  return { allowed, skipped };
}

export async function isEmailChannelEnabled(
  email: string,
  channel: EmailPrefChannel,
): Promise<boolean> {
  const prefs = await getEmailPreferences(email);
  return channel === "billing"
    ? prefs.billingAlerts
    : prefs.generalNotifications;
}

export async function simpleFormatRecipients(emails: string[]): Promise<Set<string>> {
  const normalized = [
    ...new Set(emails.map((email) => normalizeAccountEmail(email)).filter(Boolean)),
  ];
  if (normalized.length === 0) return new Set();
  const rows = await EmailPreference.find({
    email: { $in: normalized },
    simpleFormat: true,
  })
    .select("email")
    .lean();
  return new Set(rows.map((row) => row.email));
}

export async function setSimpleFormat(email: string, on: boolean): Promise<void> {
  const normalized = normalizeAccountEmail(email);
  if (!normalized) {
    throw new Error("Email is required");
  }
  await EmailPreference.findOneAndUpdate(
    { email: normalized },
    { $set: { email: normalized, simpleFormat: on } },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

/** Conservative merge when two addresses collide: off wins (simple format: on wins). */
export async function renameEmailPreferences(
  fromEmail: string,
  toEmail: string,
): Promise<void> {
  const from = normalizeAccountEmail(fromEmail);
  const to = normalizeAccountEmail(toEmail);
  if (!from || !to || from === to) return;

  const existing = await EmailPreference.findOne({ email: from });
  if (!existing) return;

  const conflict = await EmailPreference.findOne({ email: to });
  if (conflict) {
    conflict.generalNotifications =
      conflict.generalNotifications !== false &&
      existing.generalNotifications !== false;
    conflict.billingAlerts =
      conflict.billingAlerts !== false && existing.billingAlerts !== false;
    conflict.simpleFormat = Boolean(conflict.simpleFormat || existing.simpleFormat);
    const bothOn = conflict.generalNotifications && conflict.billingAlerts;
    if (bothOn) {
      conflict.unsubscribedAt = null;
      conflict.unsubscribeSource = "";
    } else if (!conflict.unsubscribedAt && existing.unsubscribedAt) {
      conflict.unsubscribedAt = existing.unsubscribedAt;
      conflict.unsubscribeSource = existing.unsubscribeSource || "";
    }
    await conflict.save();
    await existing.deleteOne();
    return;
  }

  existing.email = to;
  await existing.save();
}
