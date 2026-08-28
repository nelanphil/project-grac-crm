import { Types } from "mongoose";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
import {
  CommunicationStatus,
  ITwilioCommunication,
} from "../models/mongo/TwilioCommunication";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { normalizePhoneDigits } from "./customerSites";

export function mapTwilioMessageStatus(
  status: string | undefined | null,
): CommunicationStatus {
  const s = (status ?? "").toLowerCase();
  switch (s) {
    case "queued":
    case "accepted":
    case "scheduled":
      return "queued";
    case "sending":
    case "sent":
      return "sent";
    case "delivered":
    case "read":
      return "delivered";
    case "failed":
    case "undelivered":
      return "failed";
    case "received":
      return "received";
    default:
      return "sent";
  }
}

export function mapTwilioCallStatus(
  status: string | undefined | null,
): CommunicationStatus {
  const s = (status ?? "").toLowerCase();
  switch (s) {
    case "queued":
      return "queued";
    case "ringing":
      return "ringing";
    case "in-progress":
      return "in-progress";
    case "completed":
      return "completed";
    case "busy":
      return "busy";
    case "no-answer":
    case "no_answer":
      return "no-answer";
    case "canceled":
    case "cancelled":
      return "canceled";
    case "failed":
      return "failed";
    default:
      return "queued";
  }
}

export async function findContactByPhone(phone: string): Promise<{
  contactRef: Types.ObjectId;
  customerRef: Types.ObjectId;
} | null> {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 7) return null;

  const contacts = await CustomerContact.find({
    phone: { $exists: true, $nin: [null, ""] },
  })
    .select("_id customerRef phone")
    .lean();

  const match = contacts.find((c) => {
    const d = normalizePhoneDigits(c.phone);
    if (d.length < 7) return false;
    return (
      d === digits ||
      d.endsWith(digits) ||
      digits.endsWith(d) ||
      (d.length >= 10 &&
        digits.length >= 10 &&
        d.slice(-10) === digits.slice(-10))
    );
  });

  if (!match) return null;
  return {
    contactRef: match._id as Types.ObjectId,
    customerRef: match.customerRef as Types.ObjectId,
  };
}

export async function accountNameMap(
  accountIds: string[],
): Promise<Map<string, { friendlyName: string; accountSid: string }>> {
  const unique = [...new Set(accountIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const accounts = await TwilioAccount.find({
    _id: { $in: unique.filter((id) => Types.ObjectId.isValid(id)) },
  })
    .select("_id friendlyName accountSid")
    .lean();

  return new Map(
    accounts.map((a) => [
      String(a._id),
      { friendlyName: a.friendlyName, accountSid: a.accountSid },
    ]),
  );
}

export function toPublicCommunication(
  doc: ITwilioCommunication | Record<string, unknown>,
  accountFriendlyName?: string | null,
) {
  const d =
    "toObject" in doc && typeof (doc as ITwilioCommunication).toObject === "function"
      ? (doc as ITwilioCommunication).toObject()
      : (doc as Record<string, unknown>);

  return {
    _id: String(d._id),
    twilioAccountRef: d.twilioAccountRef ? String(d.twilioAccountRef) : null,
    accountSid: d.accountSid ?? "",
    accountFriendlyName: accountFriendlyName ?? null,
    channel: d.channel,
    direction: d.direction,
    status: d.status,
    fromNumber: d.fromNumber ?? "",
    toNumber: d.toNumber ?? "",
    body: d.body ?? "",
    transcript: typeof d.transcript === "string" ? d.transcript : "",
    mediaUrls: d.mediaUrls ?? [],
    durationSeconds: d.durationSeconds ?? null,
    twilioSid: d.twilioSid ?? null,
    customerRef: d.customerRef ? String(d.customerRef) : null,
    contactRef: d.contactRef ? String(d.contactRef) : null,
    threadRef: d.threadRef ? String(d.threadRef) : null,
    templateRef: d.templateRef ? String(d.templateRef) : null,
    createdByUserRef: d.createdByUserRef ? String(d.createdByUserRef) : null,
    errorMessage: d.errorMessage ?? null,
    createdAt:
      d.createdAt instanceof Date
        ? d.createdAt.toISOString()
        : String(d.createdAt ?? ""),
    updatedAt:
      d.updatedAt instanceof Date
        ? d.updatedAt.toISOString()
        : String(d.updatedAt ?? ""),
  };
}
