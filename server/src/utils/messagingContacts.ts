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
import { payableInvoiceCustomerIds } from "./paymentLinkForCustomer";

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
  customerRef: string;
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
  contractType: string | null;
  hasPayableInvoice?: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  page: number;
  pageSize: number;
}> {
  const { channel, page, pageSize } = options;

  let customerRefFilter: Types.ObjectId[] | null = null;
  if (options.scope) {
    customerRefFilter = await customerRefsWithRenewalsInMonth(options.scope);
    if (customerRefFilter.length === 0) {
      return { contacts: [], total: 0, page, pageSize };
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

  const customerIds = [
    ...new Set(eligible.map((c) => String(c.customerRef))),
  ];
  const customers = await Customer.find({
    _id: { $in: customerIds },
    deletedAt: null,
    $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
  })
    .select("_id first last address city state zip phone accountName")
    .lean();

  const customerById = new Map(customers.map((c) => [String(c._id), c]));

  const activeContacts = eligible.filter((c) =>
    customerById.has(String(c.customerRef)),
  );

  const total = activeContacts.length;
  const start = (page - 1) * pageSize;
  const pageRows = activeContacts.slice(start, start + pageSize);

  const renewalMap = options.scope
    ? await resolveRenewalsForCustomers(
        pageRows.map((c) => c.customerRef),
        options.scope,
      )
    : new Map();

  const payableIds =
    channel === "email"
      ? await payableInvoiceCustomerIds(
          pageRows.map((c) => String(c.customerRef)),
        )
      : null;

  const contacts = pageRows.map((c) => {
    const customer = customerById.get(String(c.customerRef))!;
    const renewalInfo = renewalMap.get(String(c.customerRef)) ?? {
      renewalDueDate: null as Date | null,
      contractType: null as string | null,
    };

    return {
      _id: String(c._id),
      first: c.first ?? "",
      last: c.last ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      label: c.label ?? "",
      isPrimary: Boolean(c.isPrimary),
      customerRef: String(c.customerRef),
      customer: {
        _id: String(customer._id),
        accountName: customer.accountName ?? "",
        first: customer.first ?? "",
        last: customer.last ?? "",
        address: customer.address ?? "",
        city: customer.city ?? "",
        state: customer.state ?? "",
        zip: customer.zip ?? "",
        phone: customer.phone ?? "",
      },
      renewalDueDate: renewalInfo.renewalDueDate
        ? renewalInfo.renewalDueDate.toISOString()
        : null,
      contractType: renewalInfo.contractType,
      ...(payableIds
        ? { hasPayableInvoice: payableIds.has(String(c.customerRef)) }
        : {}),
    };
  });

  return { contacts, total, page, pageSize };
}
