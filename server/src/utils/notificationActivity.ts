import { Customer } from "../models/mongo/Customer";
import { CustomerContact } from "../models/mongo/CustomerContact";
import {
  recordCustomerActivityAsync,
  type RecordActivityInput,
} from "../services/customerActivity.service";
import {
  accountEmailRegex,
  normalizeAccountEmail,
} from "./provisionCustomerAccount";
import { smsPreferenceKey } from "./smsPreferences";
import type { EmailPreferenceValues } from "./emailPreferences";

export async function customerRefsForEmail(email: string): Promise<string[]> {
  const emailRx = accountEmailRegex(email);
  if (!emailRx) return [];
  const [contacts, customers] = await Promise.all([
    CustomerContact.find({ email: emailRx, deletedAt: null })
      .select("customerRef")
      .lean(),
    Customer.find({
      email: emailRx,
      deletedAt: null,
      $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
    })
      .select("_id")
      .lean(),
  ]);
  const seen = new Set<string>();
  for (const customer of customers) seen.add(String(customer._id));
  for (const contact of contacts) {
    if (contact.customerRef) seen.add(String(contact.customerRef));
  }
  return [...seen];
}

export async function customerRefsForPhone(phone: string): Promise<string[]> {
  const key = smsPreferenceKey(phone);
  if (!key) return [];
  const digits = { $in: [key, `1${key}`] };
  const [contacts, customers] = await Promise.all([
    CustomerContact.find({ deletedAt: null, phoneDigits: digits })
      .select("customerRef")
      .lean(),
    Customer.find({
      deletedAt: null,
      phoneDigits: digits,
      $or: [{ mergedIntoRef: null }, { mergedIntoRef: { $exists: false } }],
    })
      .select("_id")
      .lean(),
  ]);
  const seen = new Set<string>();
  for (const customer of customers) seen.add(String(customer._id));
  for (const contact of contacts) {
    if (contact.customerRef) seen.add(String(contact.customerRef));
  }
  return [...seen];
}

function recordForCustomers(
  customerRefs: Iterable<string>,
  input: Omit<RecordActivityInput, "customerRef">,
): void {
  for (const customerRef of customerRefs) {
    recordCustomerActivityAsync({ ...input, customerRef });
  }
}

export async function recordEmailPreferenceChange(opts: {
  email: string;
  before: Pick<EmailPreferenceValues, "generalNotifications" | "billingAlerts">;
  after: Pick<EmailPreferenceValues, "generalNotifications" | "billingAlerts">;
  actorKind: RecordActivityInput["actorKind"];
  actorName: string;
  actorUserId?: string | null;
  source: RecordActivityInput["source"];
}): Promise<void> {
  const changes: { action: string; summary: string; channel: string }[] = [];
  if (opts.before.generalNotifications && !opts.after.generalNotifications) {
    changes.push({
      action: "unsubscribed",
      summary: "Unsubscribed from emails",
      channel: "general",
    });
  } else if (!opts.before.generalNotifications && opts.after.generalNotifications) {
    changes.push({
      action: "resubscribed",
      summary: "Turned email notifications back on",
      channel: "general",
    });
  }
  if (opts.before.billingAlerts && !opts.after.billingAlerts) {
    changes.push({
      action: "unsubscribed",
      summary: "Unsubscribed from billing emails",
      channel: "billing",
    });
  } else if (!opts.before.billingAlerts && opts.after.billingAlerts) {
    changes.push({
      action: "resubscribed",
      summary: "Turned billing emails back on",
      channel: "billing",
    });
  }
  if (changes.length === 0) return;
  const refs = await customerRefsForEmail(opts.email);
  for (const change of changes) {
    recordForCustomers(refs, {
      category: "communication",
      action: change.action,
      summary: change.summary,
      actorKind: opts.actorKind,
      actorName: opts.actorName,
      actorUserId: opts.actorUserId,
      entityType: "email_preference",
      entityId: normalizeAccountEmail(opts.email),
      source: opts.source,
      metadata: { channel: change.channel, email: normalizeAccountEmail(opts.email) },
    });
  }
}

export async function recordSmsPreferenceActivity(opts: {
  phone: string;
  extraCustomerRefs?: Array<string | null | undefined>;
  action: "opted_out" | "resubscribed";
  summary: string;
  actorKind: RecordActivityInput["actorKind"];
  actorName: string;
  actorUserId?: string | null;
  source: RecordActivityInput["source"];
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const refs = new Set(await customerRefsForPhone(opts.phone));
  for (const id of opts.extraCustomerRefs ?? []) {
    if (id) refs.add(String(id));
  }
  recordForCustomers(refs, {
    category: "communication",
    action: opts.action,
    summary: opts.summary,
    actorKind: opts.actorKind,
    actorName: opts.actorName,
    actorUserId: opts.actorUserId,
    entityType: opts.entityType,
    entityId: opts.entityId,
    source: opts.source,
    metadata: opts.metadata,
  });
}
