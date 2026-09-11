import mongoose, { Types } from "mongoose";
import { activeCustomerFilter, Customer } from "../models/mongo/Customer";
import { CustomerAddress } from "../models/mongo/CustomerAddress";
import {
  activeContactFilter,
  CustomerContact,
} from "../models/mongo/CustomerContact";
import {
  accountEmailRegex,
  normalizeAccountEmail,
} from "./provisionCustomerAccount";
import {
  canonicalPhoneDigits,
  normalizeAddressKey,
  normalizePhoneDigits,
} from "./customerSites";

export const MIN_PHONE_DIGITS_FOR_CHECK = 7;
export const MIN_ACCOUNT_NAME_LEN = 2;

export const DUPLICATE_ACCOUNT_NAME =
  "A customer with this account name already exists.";
export const DUPLICATE_ADDRESS =
  "This address already exists on another customer record.";
export const DUPLICATE_PRIMARY_PHONE =
  "This phone number is already tied to a customer.";
export const DUPLICATE_PRIMARY_EMAIL =
  "This email is already tied to a customer.";
export const DUPLICATE_CONTACT_PHONE =
  "A contact with this phone number already exists.";
export const DUPLICATE_CONTACT_EMAIL =
  "A contact with this email already exists.";
export const DUPLICATE_ADDRESS_IN_PAYLOAD =
  "The same address is listed more than once.";

export type DuplicateSeverity = "none" | "warning" | "blocking";

export type DuplicateMatch = {
  _id: string;
  legacyId: number;
  accountName: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  contactId?: string;
  isPrimaryContact?: boolean;
};

export type DuplicateFieldResult = {
  severity: DuplicateSeverity;
  message?: string;
  matches: DuplicateMatch[];
};

export type DuplicateCheckContactInput = {
  key: string;
  phone?: string;
  email?: string;
  isPrimary?: boolean;
};

export type DuplicateCheckAddressInput = {
  key: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
};

export type DuplicateCheckInput = {
  excludeId?: string;
  accountName?: string;
  contacts?: DuplicateCheckContactInput[];
  addresses?: DuplicateCheckAddressInput[];
};

export type DuplicateCheckResult = {
  accountName: DuplicateFieldResult;
  contacts: Record<
    string,
    { phone: DuplicateFieldResult; email: DuplicateFieldResult }
  >;
  addresses: Record<string, DuplicateFieldResult>;
};

const CUSTOMER_MATCH_FIELDS =
  "_id legacyId accountName first last phone email address city state zip";

const notMergedFilter = {
  $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function usPhonePattern(digits: string): RegExp {
  return new RegExp(
    `(^|\\D)${digits.slice(0, 3)}\\D*${digits.slice(3, 6)}\\D*${digits.slice(6)}(\\D|$)`,
  );
}

function objectIdOrNull(id?: string): Types.ObjectId | null {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) return null;
  return new mongoose.Types.ObjectId(id);
}

export function normalizeAccountNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function recordAccountName(customer: {
  accountName?: string | null;
  first?: string | null;
  last?: string | null;
}): string {
  const account = (customer.accountName ?? "").trim();
  if (account) return account;
  return `${customer.first ?? ""} ${customer.last ?? ""}`.trim();
}

export function accountNamesMatch(a: string, b: string): boolean {
  const left = normalizeAccountNameKey(a);
  const right = normalizeAccountNameKey(b);
  return Boolean(left) && left === right;
}

export function classifyContactField(
  matches: DuplicateMatch[],
  isPrimary: boolean,
): DuplicateSeverity {
  if (matches.length === 0) return "none";
  return isPrimary ? "blocking" : "warning";
}

export function classifyUniqueField(
  matches: DuplicateMatch[],
): DuplicateSeverity {
  return matches.length > 0 ? "blocking" : "none";
}

export function contactFieldMessage(
  field: "phone" | "email",
  severity: DuplicateSeverity,
): string | undefined {
  if (severity === "none") return undefined;
  if (field === "phone") {
    return severity === "blocking"
      ? DUPLICATE_PRIMARY_PHONE
      : DUPLICATE_CONTACT_PHONE;
  }
  return severity === "blocking"
    ? DUPLICATE_PRIMARY_EMAIL
    : DUPLICATE_CONTACT_EMAIL;
}

export function uniqueFieldMessage(
  field: "accountName" | "address",
  severity: DuplicateSeverity,
): string | undefined {
  if (severity !== "blocking") return undefined;
  return field === "accountName" ? DUPLICATE_ACCOUNT_NAME : DUPLICATE_ADDRESS;
}

function formatCustomerMatch(
  customer: {
    _id: Types.ObjectId;
    legacyId?: number;
    accountName?: string | null;
    first?: string | null;
    last?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
  },
  extra?: { contactId?: string; isPrimaryContact?: boolean },
): DuplicateMatch {
  return {
    _id: customer._id.toString(),
    legacyId: customer.legacyId ?? 0,
    accountName: customer.accountName ?? "",
    first: customer.first ?? "",
    last: customer.last ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    address: customer.address ?? "",
    city: customer.city ?? "",
    state: customer.state ?? "",
    zip: customer.zip ?? "",
    ...extra,
  };
}

function excludeFilter(excludeId?: string): Record<string, unknown> {
  const id = objectIdOrNull(excludeId);
  return id ? { _id: { $ne: id } } : {};
}

async function loadCustomersByIds(
  ids: Types.ObjectId[],
  excludeId?: string,
): Promise<Map<string, DuplicateMatch>> {
  if (ids.length === 0) return new Map();
  const unique = [
    ...new Map(ids.map((id) => [id.toString(), id])).values(),
  ];
  const rows = await Customer.find({
    _id: { $in: unique },
    ...activeCustomerFilter,
    ...notMergedFilter,
    ...excludeFilter(excludeId),
  })
    .select(CUSTOMER_MATCH_FIELDS)
    .lean();

  return new Map(
    rows.map((row) => [row._id.toString(), formatCustomerMatch(row)]),
  );
}

function mergeContactOntoMatch(
  match: DuplicateMatch,
  contact: { _id: Types.ObjectId; isPrimary?: boolean },
): DuplicateMatch {
  return {
    ...match,
    contactId: contact._id.toString(),
    isPrimaryContact:
      match.isPrimaryContact === true || contact.isPrimary === true,
  };
}

export async function findPhoneMatches(
  phone: string,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < MIN_PHONE_DIGITS_FOR_CHECK) return [];

  const canonical = canonicalPhoneDigits(phone);
  const searchDigits = canonical ?? digits;
  const phoneOr: Array<Record<string, unknown>> = [
    { phoneDigits: searchDigits },
  ];
  if (searchDigits.length === 10) {
    phoneOr.push({ phoneDigits: `1${searchDigits}` });
    phoneOr.push({ phone: usPhonePattern(searchDigits) });
  }

  const [customers, contacts] = await Promise.all([
    Customer.find({
      ...activeCustomerFilter,
      ...notMergedFilter,
      ...excludeFilter(excludeId),
      $or: phoneOr,
    })
      .select(CUSTOMER_MATCH_FIELDS)
      .lean(),
    searchDigits.length === 10
      ? CustomerContact.find({
          ...activeContactFilter,
          phone: usPhonePattern(searchDigits),
        })
          .select("customerRef isPrimary")
          .lean()
      : Promise.resolve([]),
  ]);

  const byId = new Map(
    customers.map((row) => [row._id.toString(), formatCustomerMatch(row)]),
  );

  const missingContactCustomerIds = contacts
    .map((contact) => contact.customerRef)
    .filter((id) => id && !byId.has(id.toString()));
  const extra = await loadCustomersByIds(
    missingContactCustomerIds,
    excludeId,
  );
  for (const [id, match] of extra) byId.set(id, match);

  for (const contact of contacts) {
    const id = contact.customerRef?.toString();
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) continue;
    byId.set(id, mergeContactOntoMatch(existing, contact));
  }

  return [...byId.values()];
}

export async function findEmailMatches(
  email: string,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const emailRx = accountEmailRegex(email);
  if (!emailRx) return [];

  const [customers, contacts] = await Promise.all([
    Customer.find({
      ...activeCustomerFilter,
      ...notMergedFilter,
      ...excludeFilter(excludeId),
      email: emailRx,
    })
      .select(CUSTOMER_MATCH_FIELDS)
      .lean(),
    CustomerContact.find({
      ...activeContactFilter,
      email: emailRx,
    })
      .select("customerRef isPrimary")
      .lean(),
  ]);

  const byId = new Map(
    customers.map((row) => [row._id.toString(), formatCustomerMatch(row)]),
  );

  const missingContactCustomerIds = contacts
    .map((contact) => contact.customerRef)
    .filter((id) => id && !byId.has(id.toString()));
  const extra = await loadCustomersByIds(
    missingContactCustomerIds,
    excludeId,
  );
  for (const [id, match] of extra) byId.set(id, match);

  for (const contact of contacts) {
    const id = contact.customerRef?.toString();
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) continue;
    byId.set(id, mergeContactOntoMatch(existing, contact));
  }

  return [...byId.values()];
}

export async function findAccountNameMatches(
  accountName: string,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const trimmed = accountName.trim();
  if (trimmed.length < MIN_ACCOUNT_NAME_LEN) return [];

  const nameRx = new RegExp(
    `^${trimmed.split(/\s+/).map(escapeRegex).join("\\s+")}$`,
    "i",
  );
  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.slice(1).join(" ");
  const or: Array<Record<string, unknown>> = [{ accountName: nameRx }];
  if (first && last) {
    or.push({
      $and: [
        {
          $or: [
            { accountName: "" },
            { accountName: null },
            { accountName: { $exists: false } },
          ],
        },
        { first: new RegExp(`^${escapeRegex(first)}$`, "i") },
        { last: new RegExp(`^${escapeRegex(last)}$`, "i") },
      ],
    });
  }

  const rows = await Customer.find({
    ...activeCustomerFilter,
    ...notMergedFilter,
    ...excludeFilter(excludeId),
    $or: or,
  })
    .select(CUSTOMER_MATCH_FIELDS)
    .lean();

  return rows
    .filter((row) => accountNamesMatch(recordAccountName(row), trimmed))
    .map((row) => formatCustomerMatch(row));
}

export async function findAddressMatches(
  address: { address?: string; zip?: string },
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const key = normalizeAddressKey(address.address, address.zip);
  if (!key) return [];

  const zip = (address.zip ?? "").trim();
  const zipDigits = zip.replace(/\D/g, "");
  const zipRx =
    zipDigits.length >= 5
      ? new RegExp(`^${escapeRegex(zipDigits.slice(0, 5))}`)
      : new RegExp(`^${escapeRegex(zip)}`, "i");

  const [sites, customers] = await Promise.all([
    CustomerAddress.find({ zip: zipRx })
      .select("customerRef address zip")
      .lean(),
    Customer.find({
      ...activeCustomerFilter,
      ...notMergedFilter,
      ...excludeFilter(excludeId),
      zip: zipRx,
    })
      .select(CUSTOMER_MATCH_FIELDS)
      .lean(),
  ]);

  const matchingIds = new Set<string>();
  for (const site of sites) {
    if (normalizeAddressKey(site.address, site.zip) === key) {
      matchingIds.add(site.customerRef.toString());
    }
  }
  for (const customer of customers) {
    if (normalizeAddressKey(customer.address, customer.zip) === key) {
      matchingIds.add(customer._id.toString());
    }
  }

  const loaded = await loadCustomersByIds(
    [...matchingIds]
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id)),
    excludeId,
  );
  return [...loaded.values()];
}

function fieldResult(
  matches: DuplicateMatch[],
  severity: DuplicateSeverity,
  message?: string,
): DuplicateFieldResult {
  return {
    severity,
    message,
    matches,
  };
}

export async function buildDuplicateCheckResult(
  input: DuplicateCheckInput,
): Promise<DuplicateCheckResult> {
  const excludeId = input.excludeId;
  const contacts = input.contacts ?? [];
  const addresses = input.addresses ?? [];

  const uniquePhones = [
    ...new Set(
      contacts
        .map((c) => c.phone?.trim() ?? "")
        .filter((phone) => normalizePhoneDigits(phone).length >= MIN_PHONE_DIGITS_FOR_CHECK),
    ),
  ];
  const uniqueEmails = [
    ...new Set(
      contacts
        .map((c) => normalizeAccountEmail(c.email ?? ""))
        .filter(Boolean),
    ),
  ];
  const uniqueAddressKeys = new Map<
    string,
    { address: string; zip: string }
  >();
  for (const addr of addresses) {
    const key = normalizeAddressKey(addr.address, addr.zip);
    if (key && !uniqueAddressKeys.has(key)) {
      uniqueAddressKeys.set(key, {
        address: addr.address ?? "",
        zip: addr.zip ?? "",
      });
    }
  }

  const [accountMatches, phoneEntries, emailEntries, addressEntries] =
    await Promise.all([
      findAccountNameMatches(input.accountName ?? "", excludeId),
      Promise.all(
        uniquePhones.map(
          async (phone) =>
            [phone, await findPhoneMatches(phone, excludeId)] as const,
        ),
      ),
      Promise.all(
        uniqueEmails.map(
          async (email) =>
            [email, await findEmailMatches(email, excludeId)] as const,
        ),
      ),
      Promise.all(
        [...uniqueAddressKeys.entries()].map(
          async ([key, addr]) =>
            [key, await findAddressMatches(addr, excludeId)] as const,
        ),
      ),
    ]);

  const phonesByValue = new Map(phoneEntries);
  const emailsByValue = new Map(emailEntries);
  const addressesByKey = new Map(addressEntries);

  const accountSeverity = classifyUniqueField(accountMatches);
  const result: DuplicateCheckResult = {
    accountName: fieldResult(
      accountMatches,
      accountSeverity,
      uniqueFieldMessage("accountName", accountSeverity),
    ),
    contacts: {},
    addresses: {},
  };

  for (const contact of contacts) {
    const phoneMatches = phonesByValue.get(contact.phone?.trim() ?? "") ?? [];
    const emailKey = normalizeAccountEmail(contact.email ?? "");
    const emailMatches = emailKey ? (emailsByValue.get(emailKey) ?? []) : [];
    const isPrimary = contact.isPrimary === true;
    const phoneSeverity = classifyContactField(phoneMatches, isPrimary);
    const emailSeverity = classifyContactField(emailMatches, isPrimary);
    result.contacts[contact.key] = {
      phone: fieldResult(
        phoneMatches,
        phoneSeverity,
        contactFieldMessage("phone", phoneSeverity),
      ),
      email: fieldResult(
        emailMatches,
        emailSeverity,
        contactFieldMessage("email", emailSeverity),
      ),
    };
  }

  for (const addr of addresses) {
    const key = normalizeAddressKey(addr.address, addr.zip);
    const matches = key ? (addressesByKey.get(key) ?? []) : [];
    const severity = classifyUniqueField(matches);
    result.addresses[addr.key] = fieldResult(
      matches,
      severity,
      uniqueFieldMessage("address", severity),
    );
  }

  return result;
}

export function firstBlockingMessage(
  result: DuplicateCheckResult,
): string | null {
  if (result.accountName.severity === "blocking") {
    return result.accountName.message ?? DUPLICATE_ACCOUNT_NAME;
  }
  for (const contact of Object.values(result.contacts)) {
    if (contact.phone.severity === "blocking") {
      return contact.phone.message ?? DUPLICATE_PRIMARY_PHONE;
    }
    if (contact.email.severity === "blocking") {
      return contact.email.message ?? DUPLICATE_PRIMARY_EMAIL;
    }
  }
  for (const address of Object.values(result.addresses)) {
    if (address.severity === "blocking") {
      return address.message ?? DUPLICATE_ADDRESS;
    }
  }
  return null;
}

export function hasBlockingDuplicates(result: DuplicateCheckResult): boolean {
  return firstBlockingMessage(result) !== null;
}
