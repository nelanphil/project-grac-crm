import { Types } from "mongoose";
import { CustomerContact } from "../models/mongo/CustomerContact";
import {
  SmsOptOutSource,
  SmsPreference,
} from "../models/mongo/SmsPreference";
import { normalizePhoneDigits } from "./customerSites";

export interface SmsPreferenceValues {
  phoneDigits: string;
  textNotifications: boolean;
  optedOutAt: Date | null;
  optOutSource: SmsOptOutSource | "";
}

const SMS_ON: SmsPreferenceValues = {
  phoneDigits: "",
  textNotifications: true,
  optedOutAt: null,
  optOutSource: "",
};

/** Last 10 digits. Null when the value is not a full mobile number. */
export function smsPreferenceKey(
  phone: string | null | undefined,
): string | null {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

export async function getSmsPreference(
  phone: string | null | undefined,
): Promise<SmsPreferenceValues> {
  const key = smsPreferenceKey(phone);
  if (!key) return { ...SMS_ON };
  const row = await SmsPreference.findOne({ phoneDigits: key }).lean();
  if (!row || row.textNotifications !== false) {
    return { ...SMS_ON, phoneDigits: key };
  }
  return {
    phoneDigits: key,
    textNotifications: false,
    optedOutAt: row.optedOutAt ?? null,
    optOutSource: row.optOutSource || "",
  };
}

export async function isSmsEnabled(
  phone: string | null | undefined,
): Promise<boolean> {
  const prefs = await getSmsPreference(phone);
  return prefs.textNotifications;
}

/** Phone keys that have text notifications turned off. */
export async function smsOptedOutDigits(
  phones: Array<string | null | undefined>,
): Promise<Set<string>> {
  const keys = [
    ...new Set(
      phones
        .map((phone) => smsPreferenceKey(phone))
        .filter((key): key is string => Boolean(key)),
    ),
  ];
  if (keys.length === 0) return new Set();
  const rows = await SmsPreference.find({
    phoneDigits: { $in: keys },
    textNotifications: false,
  })
    .select("phoneDigits")
    .lean();
  return new Set(rows.map((row) => row.phoneDigits));
}

export async function setSmsOptOut(input: {
  phone: string | null | undefined;
  source: Exclude<SmsOptOutSource, "">;
  messageRef?: Types.ObjectId | null;
  userRef?: Types.ObjectId | null;
}): Promise<{ changed: boolean }> {
  const key = smsPreferenceKey(input.phone);
  if (!key) return { changed: false };
  const existing = await SmsPreference.findOne({ phoneDigits: key }).lean();
  const already = existing?.textNotifications === false;
  await SmsPreference.findOneAndUpdate(
    { phoneDigits: key },
    {
      $set: {
        phoneDigits: key,
        textNotifications: false,
        optedOutAt: already && existing?.optedOutAt ? existing.optedOutAt : new Date(),
        optOutSource: already && existing?.optOutSource ? existing.optOutSource : input.source,
        ...(input.messageRef ? { optOutMessageRef: input.messageRef } : {}),
        ...(input.userRef ? { optedOutByUserRef: input.userRef } : {}),
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );
  return { changed: !already };
}

/** Turns texts back on. Returns true only when they were actually off. */
export async function clearSmsOptOut(
  phone: string | null | undefined,
): Promise<boolean> {
  const key = smsPreferenceKey(phone);
  if (!key) return false;
  const existing = await SmsPreference.findOne({ phoneDigits: key });
  if (!existing || existing.textNotifications !== false) return false;
  existing.textNotifications = true;
  existing.optedOutAt = null;
  existing.optOutSource = "";
  existing.optOutMessageRef = null;
  existing.optedOutByUserRef = null;
  await existing.save();
  return true;
}

export async function partitionContactsBySmsOptOut(
  contactIds: string[],
): Promise<{ allowed: string[]; skipped: string[] }> {
  const valid = contactIds.filter((id) => Types.ObjectId.isValid(id));
  const contacts = valid.length
    ? await CustomerContact.find({ _id: { $in: valid } })
        .select("_id phone")
        .lean()
    : [];
  const phoneById = new Map(
    contacts.map((contact) => [String(contact._id), contact.phone ?? ""]),
  );
  const opted = await smsOptedOutDigits([...phoneById.values()]);
  const allowed: string[] = [];
  const skipped: string[] = [];
  for (const id of contactIds) {
    const key = smsPreferenceKey(phoneById.get(id) ?? "");
    if (key && opted.has(key)) skipped.push(id);
    else allowed.push(id);
  }
  return { allowed, skipped };
}
