import { EmailPreference } from "../models/mongo/EmailPreference";
import { normalizeAccountEmail } from "./provisionCustomerAccount";
import type { EmailPrefChannel } from "./unsubscribeToken";

export interface EmailPreferenceValues {
  email: string;
  generalNotifications: boolean;
  billingAlerts: boolean;
}

export const DEFAULT_EMAIL_PREFERENCES = {
  generalNotifications: true,
  billingAlerts: true,
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
  };
}

export async function setEmailPreferences(
  email: string,
  patch: {
    generalNotifications?: boolean;
    billingAlerts?: boolean;
  },
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

  const row = await EmailPreference.findOneAndUpdate(
    { email: normalized },
    { $set: { email: normalized, ...next } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();

  return {
    email: normalized,
    generalNotifications: row?.generalNotifications !== false,
    billingAlerts: row?.billingAlerts !== false,
  };
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

/** Conservative merge when two addresses collide: off wins. */
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
    await conflict.save();
    await existing.deleteOne();
    return;
  }

  existing.email = to;
  await existing.save();
}
