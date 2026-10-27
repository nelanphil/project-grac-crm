import { Types } from "mongoose";
import { Customer, activeCustomerFilter } from "../models/mongo/Customer";
import {
  CustomerContact,
  activeContactFilter,
} from "../models/mongo/CustomerContact";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { InboxHandleKind } from "../models/mongo/InboxConversation";
import { canonicalPhoneDigits } from "../utils/customerSites";
import { normalizeAccountEmail } from "../utils/provisionCustomerAccount";

const notMerged = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

type NamedCustomer = {
  _id: Types.ObjectId;
  accountName?: string | null;
  first?: string | null;
  last?: string | null;
};

function letters(value: string): string {
  return value.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** How well a From name matches a customer. Shared addresses use this as a tie-break. */
export function scoreCustomerName(
  customer: { accountName?: string | null; first?: string | null; last?: string | null },
  fromName: string,
): number {
  const name = letters(fromName);
  if (!name) return 0;
  const parts = name.split(" ");
  const first = (customer.first || "").toLowerCase().replace(/[^a-z]/g, "");
  const last = (customer.last || "").toLowerCase().replace(/[^a-z]/g, "");
  const account = letters(customer.accountName || "");
  let score = 0;
  if (account && account === name) score += 6;
  if (last && parts.includes(last)) score += 2;
  if (
    first &&
    parts.some(
      (part) => part.length >= 3 && (first.startsWith(part) || part.startsWith(first)),
    )
  ) {
    score += 3;
  }
  return score;
}

function pickByName(customers: NamedCustomer[], fromName: string): Types.ObjectId | null {
  const ranked = customers
    .map((customer) => ({ customer, score: scoreCustomerName(customer, fromName) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const next = ranked[1];
  if (!best || best.score <= 0) return null;
  if (next && next.score === best.score) return null;
  return best.customer._id;
}

async function customersById(ids: string[]): Promise<NamedCustomer[]> {
  const valid = ids.filter((id) => Types.ObjectId.isValid(id));
  if (valid.length === 0) return [];
  return Customer.find({
    _id: { $in: valid },
    ...activeCustomerFilter,
    ...notMerged,
  })
    .select("accountName first last")
    .lean();
}

async function emailCandidates(email: string): Promise<NamedCustomer[]> {
  const [customers, contacts] = await Promise.all([
    Customer.find({
      ...activeCustomerFilter,
      ...notMerged,
      email,
    })
      .collation({ locale: "en", strength: 2 })
      .select("accountName first last")
      .lean(),
    CustomerContact.find({
      ...activeContactFilter,
      email,
    })
      .collation({ locale: "en", strength: 2 })
      .select("customerRef")
      .lean(),
  ]);
  const seen = new Set(customers.map((row) => String(row._id)));
  const extra = [
    ...new Set(
      contacts
        .map((contact) => (contact.customerRef ? String(contact.customerRef) : ""))
        .filter((id) => id && !seen.has(id)),
    ),
  ];
  const more = await customersById(extra);
  return [...customers, ...more];
}

async function phoneCandidates(digits: string): Promise<NamedCustomer[]> {
  const pattern = new RegExp(digits.split("").join("\\D*"));
  const [customers, contacts] = await Promise.all([
    Customer.find({
      ...activeCustomerFilter,
      ...notMerged,
      phoneDigits: { $in: [digits, `1${digits}`] },
    })
      .select("accountName first last")
      .lean(),
    CustomerContact.find({
      ...activeContactFilter,
      phone: pattern,
    })
      .select("customerRef phone")
      .lean(),
  ]);
  const seen = new Set(customers.map((row) => String(row._id)));
  const extra = [
    ...new Set(
      contacts
        .filter((contact) => canonicalPhoneDigits(contact.phone) === digits)
        .map((contact) => (contact.customerRef ? String(contact.customerRef) : ""))
        .filter((id) => id && !seen.has(id)),
    ),
  ];
  const more = await customersById(extra);
  return [...customers, ...more];
}

async function pickEmailCustomer(
  candidates: NamedCustomer[],
  email: string,
  fromName: string,
): Promise<Types.ObjectId | null> {
  if (candidates.length === 1) return candidates[0]._id;
  const ids = candidates.map((row) => row._id);
  const outbound = await EmailCommunication.find({
    customerRef: { $in: ids },
    toEmail: email,
    direction: { $ne: "inbound" },
    status: { $ne: "failed" },
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .select("customerRef")
    .lean();
  const outboundIds = [...new Set(outbound.map((row) => String(row.customerRef)))];
  if (outboundIds.length === 1) return new Types.ObjectId(outboundIds[0]);
  const pool =
    outboundIds.length > 1
      ? candidates.filter((row) => outboundIds.includes(String(row._id)))
      : candidates;
  return pickByName(pool, fromName);
}

async function pickPhoneCustomer(
  candidates: NamedCustomer[],
  digits: string,
): Promise<Types.ObjectId | null> {
  if (candidates.length === 1) return candidates[0]._id;
  const ids = candidates.map((row) => row._id);
  const pattern = new RegExp(`${digits}$`);
  const messages = await TwilioCommunication.find({
    customerRef: { $in: ids },
    $or: [{ fromNumber: pattern }, { toNumber: pattern }],
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .select("customerRef")
    .lean();
  const messageIds = [...new Set(messages.map((row) => String(row.customerRef)))];
  if (messageIds.length === 1) return new Types.ObjectId(messageIds[0]);
  return null;
}

/**
 * One customer for an inbox handle.
 * A shared email or phone stays unlinked when more than one customer matches
 * and neither prior messages nor the sender name can tell them apart.
 */
export async function resolveInboxCustomer(input: {
  handle: string;
  handleKind: InboxHandleKind;
  fromName?: string | null;
}): Promise<Types.ObjectId | null> {
  if (input.handleKind === "email") {
    const email = normalizeAccountEmail(input.handle);
    if (!email) return null;
    const candidates = await emailCandidates(email);
    if (candidates.length === 0) return null;
    return pickEmailCustomer(candidates, email, input.fromName || "");
  }
  const digits = canonicalPhoneDigits(input.handle);
  if (!digits) return null;
  const candidates = await phoneCandidates(digits);
  if (candidates.length === 0) return null;
  return pickPhoneCustomer(candidates, digits);
}
