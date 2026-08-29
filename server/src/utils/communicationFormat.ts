import { Types } from "mongoose";
import { TwilioAccount } from "../models/mongo/TwilioAccount";
import {
  CommunicationStatus,
  ITwilioCommunication,
} from "../models/mongo/TwilioCommunication";
import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { normalizePhoneDigits } from "./customerSites";
import { publicMediaUrls } from "./recordingPlayback";
import { toTranscriptLines } from "./voiceActivity";

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

function phonesMatchDigits(stored: string, incomingDigits: string): boolean {
  const d = normalizePhoneDigits(stored);
  if (d.length < 7) return false;
  return (
    d === incomingDigits ||
    d.endsWith(incomingDigits) ||
    incomingDigits.endsWith(d) ||
    (d.length >= 10 &&
      incomingDigits.length >= 10 &&
      d.slice(-10) === incomingDigits.slice(-10))
  );
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

  const match = contacts.find((c) => phonesMatchDigits(c.phone, digits));
  if (match) {
    return {
      contactRef: match._id as Types.ObjectId,
      customerRef: match.customerRef as Types.ObjectId,
    };
  }

  const customers = await Customer.find({
    deletedAt: null,
    $or: [
      { phoneDigits: { $exists: true, $nin: [null, ""] } },
      { phone: { $exists: true, $nin: [null, ""] } },
    ],
  })
    .select("_id first last phone phoneDigits")
    .lean();

  const customer = customers.find((c) => {
    if (c.phoneDigits && phonesMatchDigits(c.phoneDigits, digits)) return true;
    return phonesMatchDigits(c.phone ?? "", digits);
  });
  if (!customer) return null;

  const primary =
    (await CustomerContact.findOne({
      customerRef: customer._id,
      isPrimary: true,
    })
      .select("_id customerRef")
      .lean()) ??
    (await CustomerContact.findOne({ customerRef: customer._id })
      .select("_id customerRef")
      .lean());

  if (primary) {
    return {
      contactRef: primary._id as Types.ObjectId,
      customerRef: customer._id as Types.ObjectId,
    };
  }

  const created = await CustomerContact.create({
    customerRef: customer._id,
    first: customer.first ?? "",
    last: customer.last ?? "",
    phone: customer.phone || phone,
    email: "",
    label: "Primary",
    isPrimary: true,
  });
  return {
    contactRef: created._id as Types.ObjectId,
    customerRef: customer._id as Types.ObjectId,
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
    transcriptLines: toTranscriptLines(
      typeof d.transcript === "string" ? d.transcript : "",
    ),
    mediaUrls: publicMediaUrls(d),
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
