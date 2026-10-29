import { Types } from "mongoose";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { Customer } from "../models/mongo/Customer";
import { normalizePhoneDigits } from "./customerSites";
import {
  contactHasValidEmail,
  contactHasValidPhone,
  customerRefsWithRenewalsInMonth,
  resolveRenewalsForCustomers,
  type RenewalScope,
} from "./messagingContext";
import { lastOutboundContactForCustomers } from "./lastContact";
import { payableInvoiceCustomerIds } from "./paymentLinkForCustomer";
import { emailOptedOut } from "./emailPreferences";
import { normalizeAccountEmail } from "./provisionCustomerAccount";
import { smsOptedOutDigits, smsPreferenceKey } from "./smsPreferences";

export const HUB_CONTACT_PAGE_SIZES = new Set([25, 50, 100, 150, 200, 250]);

export type HubContactChannel = "sms" | "email";

export interface HubContactItem {
  _id: string;
  first: string;
  last: string;
  phone: string;
  email: string;
  label: string;
  isPrimary: boolean;
  customerRef: string | null;
  customer: {
    _id: string;
    accountName?: string;
    first: string;
    last: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
  };
  renewalDueDate: string | null;
  lastRenewalDate: string | null;
  renewalStatus: "due" | "overdue" | "renewed" | null;
  contractType: string | null;
  lastContact: {
    at: string;
    method: "text" | "email" | "call";
    status: string;
  } | null;
  hasPayableInvoice?: boolean;
  doNotNotify: boolean;
  doNotNotifyReason: string;
}

export function keepHubContact(
  customerRef: { toString(): string } | null | undefined,
  activeCustomerIds: ReadonlySet<string>,
): boolean {
  if (!customerRef) return true;
  return activeCustomerIds.has(String(customerRef));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function notifyBlocks(
  channel: HubContactChannel,
  contacts: { email?: string | null; phone?: string | null }[],
): Promise<
  (contact: { email?: string | null; phone?: string | null }) => {
    doNotNotify: boolean;
    doNotNotifyReason: string;
  }
> {
  if (channel === "email") {
    const opted = await emailOptedOut(contacts.map((contact) => contact.email ?? ""));
    return (contact) => {
      const email = normalizeAccountEmail(contact.email ?? "");
      if (email && opted.has(email)) {
        return {
          doNotNotify: true,
          doNotNotifyReason: "Unsubscribed from email",
        };
      }
      return { doNotNotify: false, doNotNotifyReason: "" };
    };
  }
  const opted = await smsOptedOutDigits(contacts.map((contact) => contact.phone ?? ""));
  return (contact) => {
    const key = smsPreferenceKey(contact.phone ?? "");
    if (key && opted.has(key)) {
      return {
        doNotNotify: true,
        doNotNotifyReason: "Opted out of text messages",
      };
    }
    return { doNotNotify: false, doNotNotifyReason: "" };
  };
}

export function parseHubContactPaging(query: {
  page?: unknown;
  pageSize?: unknown;
}): { page: number; pageSize: number } {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSizeRaw = parseInt(String(query.pageSize ?? "50"), 10) || 50;
  const pageSize = HUB_CONTACT_PAGE_SIZES.has(pageSizeRaw) ? pageSizeRaw : 50;
  return { page, pageSize };
}

export function parseRenewalScope(
  yearRaw: unknown,
  monthRaw: unknown,
): { scope?: RenewalScope; error?: string } {
  if (yearRaw === undefined && monthRaw === undefined) {
    return {};
  }
  if (yearRaw === undefined || monthRaw === undefined) {
    return {
      error: "Both year and month are required when filtering by renewals",
    };
  }
  const year = parseInt(String(yearRaw), 10);
  const month = parseInt(String(monthRaw), 10);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    month < 1 ||
    month > 12 ||
    year < 1970 ||
    year > 2100
  ) {
    return { error: "Invalid year or month" };
  }
  return { scope: { year, month } };
}

export async function searchHubContacts(options: {
  channel: HubContactChannel;
  search?: string;
  scope?: RenewalScope;
  page: number;
  pageSize: number;
}): Promise<{
  contacts: HubContactItem[];
  total: number;
  selectableTotal: number;
  page: number;
  pageSize: number;
}> {
  const { channel, page, pageSize } = options;

  let customerRefFilter: Types.ObjectId[] | null = null;
  if (options.scope) {
    customerRefFilter = await customerRefsWithRenewalsInMonth(options.scope);
    if (customerRefFilter.length === 0) {
      return { contacts: [], total: 0, selectableTotal: 0, page, pageSize };
    }
  }

  const search = (options.search ?? "").trim();
  const match: Record<string, unknown> =
    channel === "email"
      ? { email: { $exists: true, $nin: [null, ""] } }
      : { phone: { $exists: true, $nin: [null, ""] } };

  if (customerRefFilter) {
    match.customerRef = { $in: customerRefFilter };
  }

  if (search) {
    const re = new RegExp(escapeRegex(search), "i");
    const digits = normalizePhoneDigits(search);
    const or: Record<string, unknown>[] = [
      { first: re },
      { last: re },
      { phone: re },
      { email: re },
      { label: re },
    ];
    if (digits.length >= 3) {
      or.push({ phone: new RegExp(escapeRegex(digits), "i") });
    }

    const customerOr: Record<string, unknown>[] = [
      { first: re },
      { last: re },
      { address: re },
      { city: re },
      { phone: re },
    ];
    if (digits.length >= 3) {
      customerOr.push({ phoneDigits: new RegExp(escapeRegex(digits)) });
    }

    const matchingCustomers = await Customer.find({
      deletedAt: null,
      $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
      $and: [{ $or: customerOr }],
    })
      .select("_id")
      .lean();

    const customerIds = matchingCustomers.map((c) => c._id);
    if (customerIds.length > 0) {
      or.push({ customerRef: { $in: customerIds } });
    }

    match.$or = or;
  }

  const candidates = await CustomerContact.find(match)
    .sort({ last: 1, first: 1 })
    .lean();

  const eligible = candidates.filter((c) =>
    channel === "email"
      ? contactHasValidEmail(c.email)
      : contactHasValidPhone(c.phone),
  );

  const emptyCustomer = {
    _id: "",
    accountName: "",
    first: "",
    last: "",
    address: "",
    city: "",
    state: "",
    zip: "",
    phone: "",
  };

  const customerIds = [
    ...new Set(
      eligible
        .map((c) => (c.customerRef ? String(c.customerRef) : ""))
        .filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  const customers = await Customer.find({
    _id: { $in: customerIds },
    deletedAt: null,
    $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
  })
    .select("_id first last address city state zip phone accountName")
    .lean();

  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  const activeCustomerIds = new Set(customerById.keys());
  const activeContacts = eligible.filter((c) =>
    keepHubContact(c.customerRef, activeCustomerIds),
  );

  const total = activeContacts.length;
  const notifyBlock = await notifyBlocks(channel, activeContacts);
  const orderedContacts = [...activeContacts].sort((left, right) => {
    const leftBlocked = notifyBlock(left).doNotNotify ? 1 : 0;
    const rightBlocked = notifyBlock(right).doNotNotify ? 1 : 0;
    return leftBlocked - rightBlocked;
  });
  const start = (page - 1) * pageSize;
  const pageRows = orderedContacts.slice(start, start + pageSize);
  const selectableTotal = activeContacts.filter(
    (contact) => !notifyBlock(contact).doNotNotify,
  ).length;

  const renewalIds = pageRows
    .map((c) => c.customerRef)
    .filter((id): id is Types.ObjectId => Boolean(id));
  const renewalMap = options.scope
    ? await resolveRenewalsForCustomers(renewalIds, options.scope)
    : new Map();
  const lastContactMap = await lastOutboundContactForCustomers(renewalIds);

  const payableIds =
    channel === "email" || channel === "sms"
      ? await payableInvoiceCustomerIds(renewalIds.map((id) => String(id)))
      : null;

  const contacts = pageRows.map((c) => {
    const customer = c.customerRef
      ? customerById.get(String(c.customerRef))
      : undefined;
    const renewalInfo = c.customerRef
      ? (renewalMap.get(String(c.customerRef)) ?? {
          renewalDueDate: null as Date | null,
          lastRenewalDate: null as Date | null,
          renewalStatus: null,
          contractType: null as string | null,
        })
      : {
          renewalDueDate: null as Date | null,
          lastRenewalDate: null as Date | null,
          renewalStatus: null,
          contractType: null as string | null,
        };
    const lastContact = c.customerRef
      ? lastContactMap.get(String(c.customerRef))
      : undefined;

    return {
      _id: String(c._id),
      first: c.first ?? "",
      last: c.last ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      label: c.label ?? "",
      isPrimary: Boolean(c.isPrimary),
      customerRef: c.customerRef ? String(c.customerRef) : null,
      customer: customer
        ? {
            _id: String(customer._id),
            accountName: customer.accountName ?? "",
            first: customer.first ?? "",
            last: customer.last ?? "",
            address: customer.address ?? "",
            city: customer.city ?? "",
            state: customer.state ?? "",
            zip: customer.zip ?? "",
            phone: customer.phone ?? "",
          }
        : emptyCustomer,
      renewalDueDate: renewalInfo.renewalDueDate
        ? renewalInfo.renewalDueDate.toISOString()
        : null,
      lastRenewalDate: renewalInfo.lastRenewalDate
        ? renewalInfo.lastRenewalDate.toISOString()
        : null,
      renewalStatus: renewalInfo.renewalStatus,
      contractType: renewalInfo.contractType,
      lastContact: lastContact
        ? {
            at: lastContact.at.toISOString(),
            method: lastContact.method,
            status: lastContact.status,
          }
        : null,
      ...(payableIds
        ? {
            hasPayableInvoice: c.customerRef
              ? payableIds.has(String(c.customerRef))
              : false,
          }
        : {}),
      ...notifyBlock(c),
    };
  });

  return { contacts, total, selectableTotal, page, pageSize };
}
