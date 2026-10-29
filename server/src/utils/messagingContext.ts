import { Types } from "mongoose";
import { activeCustomerFilter, Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import { Contract } from "../models/mongo/Contract";
import { ContractTemplate } from "../models/mongo/ContractTemplate";
import {
  DUE_SOON_DAYS,
  differenceInCalendarDays,
  renewalCohortFilterForMonth,
  renewalCohortStatus,
  type RenewalCohortStatus,
} from "./contractDates";
import {
  formatDateForTemplate,
  MessageTemplateContext,
  SAMPLE_TEMPLATE_CONTEXT,
} from "./messageTemplate";
import { renewalTimingFields } from "./renewalVariants";
import { normalizePhoneDigits } from "./customerSites";

export interface RenewalScope {
  year: number;
  month: number;
}

export interface ContactRenewalInfo {
  renewalDueDate: Date | null;
  contractType: string | null;
  renewalStatus: RenewalCohortStatus | null;
  lastRenewalDate: Date | null;
  contractDate: Date | null;
}

export function emptyContactRenewal(): ContactRenewalInfo {
  return {
    renewalDueDate: null,
    contractType: null,
    renewalStatus: null,
    lastRenewalDate: null,
    contractDate: null,
  };
}

/** Due and overdue outrank a contract already renewed into next year. */
function renewalStatusRank(status: RenewalCohortStatus | null): number {
  if (status === "due" || status === "overdue") return 0;
  if (status === "renewed") return 1;
  return 2;
}

/** Customer refs in the renewal group for the given UTC month. */
export async function customerRefsWithRenewalsInMonth(
  scope: RenewalScope,
): Promise<Types.ObjectId[]> {
  const rows = await Contract.find({
    ...renewalCohortFilterForMonth(scope.year, scope.month),
    customerRef: { $exists: true, $ne: null },
    temporary: { $ne: true },
  })
    .select("customerRef")
    .lean();

  const ids = new Set<string>();
  for (const row of rows) {
    if (row.customerRef) ids.add(String(row.customerRef));
  }
  if (ids.size === 0) return [];

  const active = await Customer.find({
    _id: { $in: [...ids].map((id) => new Types.ObjectId(id)) },
    ...activeCustomerFilter,
  }).distinct("_id");
  return active as Types.ObjectId[];
}

export async function resolveRenewalForCustomer(
  customerId: Types.ObjectId | string,
  scope?: RenewalScope,
): Promise<ContactRenewalInfo> {
  const map = await resolveRenewalsForCustomers([customerId], scope);
  return map.get(String(customerId)) ?? emptyContactRenewal();
}

/** Batch-resolve soonest renewal per customer (optional month scope). */
export async function resolveRenewalsForCustomers(
  customerIds: Array<Types.ObjectId | string>,
  scope?: RenewalScope,
): Promise<Map<string, ContactRenewalInfo>> {
  const result = new Map<string, ContactRenewalInfo>();
  const unique = [
    ...new Set(customerIds.map((id) => String(id)).filter((id) => Types.ObjectId.isValid(id))),
  ];
  if (unique.length === 0) return result;

  const objectIds = unique.map((id) => new Types.ObjectId(id));
  const filter: Record<string, unknown> = {
    customerRef: { $in: objectIds },
    temporary: { $ne: true },
  };

  if (scope) {
    Object.assign(filter, renewalCohortFilterForMonth(scope.year, scope.month));
  } else {
    // Prefer soonest upcoming renewal
    filter.renewalDueDate = { $ne: null, $gte: new Date() };
  }

  const contracts = await Contract.find(filter)
    .sort({ renewalDueDate: 1 })
    .select(
      "customerRef renewalDueDate lastRenewalDate contractDate contractType templateId",
    )
    .lean();

  const labelByTemplate = new Map<string, string>();

  async function ensureTemplateLabels(
    rows: Array<{ templateId?: Types.ObjectId | null }>,
  ): Promise<void> {
    const ids = [
      ...new Set(
        rows
          .map((c) => (c.templateId ? String(c.templateId) : null))
          .filter(Boolean) as string[],
      ),
    ].filter((id) => !labelByTemplate.has(id));
    if (ids.length === 0) return;
    const templates = await ContractTemplate.find({ _id: { $in: ids } })
      .select("_id label")
      .lean();
    for (const t of templates) labelByTemplate.set(String(t._id), t.label as string);
  }

  await ensureTemplateLabels(contracts);

  function infoForContract(contract: {
    renewalDueDate?: Date | null;
    lastRenewalDate?: Date | null;
    contractDate?: Date | null;
    contractType?: string | null;
    templateId?: Types.ObjectId | null;
  }): ContactRenewalInfo {
    const templateLabel = contract.templateId
      ? labelByTemplate.get(String(contract.templateId))
      : undefined;
    const renewalDueDate = contract.renewalDueDate ?? null;
    const lastRenewalDate = contract.lastRenewalDate ?? null;
    return {
      renewalDueDate,
      lastRenewalDate,
      contractDate: contract.contractDate ?? null,
      contractType: templateLabel ?? contract.contractType ?? null,
      renewalStatus: renewalDueDate
        ? scope
          ? renewalCohortStatus(renewalDueDate, lastRenewalDate, scope)
          : differenceInCalendarDays(renewalDueDate, new Date()) < 0
            ? "overdue"
            : "due"
        : null,
    };
  }

  for (const contract of contracts) {
    const key = String(contract.customerRef);
    const next = infoForContract(contract);
    const current = result.get(key);
    // Soonest date is visited first. Replace it only when a later contract
    // is still due or overdue and the one we kept was already renewed.
    if (
      current &&
      renewalStatusRank(current.renewalStatus) <= renewalStatusRank(next.renewalStatus)
    ) {
      continue;
    }
    result.set(key, next);
  }

  // When no month scope, fill missing with soonest renewal overall (including past)
  if (!scope) {
    const missing = unique.filter((id) => !result.has(id));
    if (missing.length > 0) {
      const fallback = await Contract.find({
        customerRef: { $in: missing.map((id) => new Types.ObjectId(id)) },
        renewalDueDate: { $ne: null },
        temporary: { $ne: true },
      })
        .sort({ renewalDueDate: 1 })
        .select(
          "customerRef renewalDueDate lastRenewalDate contractDate contractType templateId",
        )
        .lean();

      await ensureTemplateLabels(fallback);

      for (const contract of fallback) {
        const key = String(contract.customerRef);
        if (result.has(key)) continue;
        result.set(key, infoForContract(contract));
      }
    }
  }

  for (const id of unique) {
    if (!result.has(id)) {
      result.set(id, emptyContactRenewal());
    }
  }

  return result;
}

export async function buildTemplateContextForContact(
  contactId: string,
  renewalScope?: RenewalScope,
  dueSoonDays: number = DUE_SOON_DAYS,
): Promise<{
  context: MessageTemplateContext;
  contact: {
    _id: string;
    first: string;
    last: string;
    phone: string;
    email: string;
    customerRef: string | null;
  };
  customer: {
    _id: string;
    first: string;
    last: string;
    address: string;
    city: string;
    state: string;
    zip: string;
  } | null;
  renewal: ContactRenewalInfo;
} | null> {
  if (!Types.ObjectId.isValid(contactId)) return null;

  const contact = await CustomerContact.findById(contactId).lean();
  if (!contact || contact.deletedAt) return null;

  const loaded = contact.customerRef
    ? await Customer.findById(contact.customerRef)
        .select("_id first last address city state zip deletedAt mergedIntoRef")
        .lean()
    : null;
  if (loaded?.deletedAt) return null;
  const customer =
    loaded && !loaded.deletedAt && !loaded.mergedIntoRef ? loaded : null;

  const renewal = customer
    ? await resolveRenewalForCustomer(customer._id, renewalScope)
    : emptyContactRenewal();

  const first = contact.first ?? "";
  const last = contact.last ?? "";
  const fullName = [first, last].filter(Boolean).join(" ").trim();

  const context: MessageTemplateContext = {
    first_name: first,
    last_name: last,
    full_name: fullName,
    phone: contact.phone ?? "",
    email: contact.email ?? "",
    customer_first: customer?.first ?? "",
    customer_last: customer?.last ?? "",
    address: customer?.address ?? "",
    city: customer?.city ?? "",
    state: customer?.state ?? "",
    zip: customer?.zip ?? "",
    renewal_due_date: formatDateForTemplate(renewal.renewalDueDate),
    contract_type: renewal.contractType ?? "",
    ...renewalTimingFields(renewal, dueSoonDays),
    payment_link: "",
  };

  return {
    context,
    contact: {
      _id: String(contact._id),
      first,
      last,
      phone: contact.phone ?? "",
      email: contact.email ?? "",
      customerRef: customer ? String(customer._id) : null,
    },
    customer: customer
      ? {
          _id: String(customer._id),
          first: customer.first ?? "",
          last: customer.last ?? "",
          address: customer.address ?? "",
          city: customer.city ?? "",
          state: customer.state ?? "",
          zip: customer.zip ?? "",
        }
      : null,
    renewal,
  };
}

export function sampleTemplateContext(): MessageTemplateContext {
  return { ...SAMPLE_TEMPLATE_CONTEXT };
}

export function contactHasValidPhone(phone: string | null | undefined): boolean {
  return normalizePhoneDigits(phone).length >= 7;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function contactHasValidEmail(email: string | null | undefined): boolean {
  return EMAIL_RE.test((email ?? "").trim());
}

/** Best-effort E.164 for US numbers (10 digits → +1…). Leaves already-international alone. */
export function toE164(phone: string): string | null {
  const digits = normalizePhoneDigits(phone);
  if (digits.length < 7) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 7) return `+${digits}`;
  return `+${digits}`;
}
