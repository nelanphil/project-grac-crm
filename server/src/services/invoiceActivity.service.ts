import { Types } from "mongoose";
import type { IInvoice } from "../models/mongo/Invoice";
import { EmailCommunication } from "../models/mongo/EmailCommunication";
import { TwilioCommunication } from "../models/mongo/TwilioCommunication";
import { CustomerActivity } from "../models/mongo/CustomerActivity";
import {
  INVOICE_CONTACT_EVENT_KINDS,
  INVOICE_PAYMENT_EVENT_KINDS,
  InvoiceEvent,
  type IInvoicePaymentDetail,
} from "../models/mongo/InvoiceEvent";
import { User } from "../models/mongo/User";
import {
  listJourneyVisitsForInvoice,
  type JourneyVisitSummary,
} from "./paymentJourney.service";
import { paymentSourceEventId } from "./invoiceEvent.service";
import {
  canRefineMethod,
  enrichSquarePaymentEventAsync,
  squarePaymentLookup,
} from "./invoicePaymentDetail.service";

const ROW_LIMIT = 200;
const INFERRED_LIMIT = 50;
/** Sends that render the invoice can be written a moment before issuedAt is stamped. */
const ISSUE_SLACK_MS = 60 * 1000;
const PREVIEW_LENGTH = 160;

export type InvoiceContactKind =
  | "email"
  | "sms"
  | "mms"
  | "viewed"
  | "pay_link_opened"
  | "checkout_started";

export interface InvoiceContactEntry {
  id: string;
  kind: InvoiceContactKind;
  to: string | null;
  subject: string | null;
  preview: string | null;
  status: string | null;
  error: string | null;
  actorName: string;
  createdAt: string;
  /** Matched by invoice number on an older message that was not linked when sent. */
  inferred: boolean;
}

export interface InvoicePaymentDetailEntry {
  channel: "in_person" | "online" | null;
  label: string;
  entryMethod: string | null;
  cardBrand: string | null;
  last4: string | null;
  wallet: string | null;
  squareProduct: string | null;
  receiptUrl: string | null;
}

export interface InvoicePaymentEntry {
  id: string;
  kind: (typeof INVOICE_PAYMENT_EVENT_KINDS)[number];
  method: string | null;
  provider: string | null;
  amountCents: number | null;
  reason: string | null;
  providerPaymentId: string | null;
  /** How the provider says the payment was taken, when it was looked up. */
  detail: InvoicePaymentDetailEntry | null;
  /** Who most likely paid, worked out from the channel and the visits on this invoice. */
  payer: string | null;
  actorName: string;
  createdAt: string;
  inferred: boolean;
}

export interface InvoiceActivity {
  contacts: InvoiceContactEntry[];
  payments: InvoicePaymentEntry[];
  visits: JourneyVisitSummary[];
}

const VISIT_KINDS = new Set<InvoiceContactKind>([
  "viewed",
  "pay_link_opened",
  "checkout_started",
]);
const VISIT_EDGE_MS = 60 * 1000;

/** Drops open and checkout rows already covered by a recorded visit. */
export function foldOpensIntoVisits(
  contacts: InvoiceContactEntry[],
  visits: Array<Pick<JourneyVisitSummary, "startedAt" | "lastEventAt">>,
): InvoiceContactEntry[] {
  if (visits.length === 0) return contacts;
  const windows = visits.map((visit) => ({
    from: new Date(visit.startedAt).getTime() - VISIT_EDGE_MS,
    to: new Date(visit.lastEventAt).getTime() + VISIT_EDGE_MS,
  }));
  return contacts.filter((entry) => {
    if (!VISIT_KINDS.has(entry.kind)) return true;
    const at = new Date(entry.createdAt).getTime();
    return !windows.some((window) => at >= window.from && at <= window.to);
  });
}

export type EmailRow = {
  _id: Types.ObjectId | string;
  toEmail: string;
  subject?: string | null;
  body?: string | null;
  status: string;
  errorMessage?: string | null;
  createdByUserRef?: Types.ObjectId | string | null;
  createdAt: Date;
};

export type TextRow = {
  _id: Types.ObjectId | string;
  channel: string;
  toNumber: string;
  body?: string | null;
  status: string;
  errorMessage?: string | null;
  createdByUserRef?: Types.ObjectId | string | null;
  createdAt: Date;
};

export type EventRow = {
  _id: Types.ObjectId | string;
  kind: string;
  method?: string | null;
  provider?: string | null;
  amountCents?: number | null;
  reason?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  paymentDetail?: IInvoicePaymentDetail | null;
  actorKind?: string | null;
  actorName?: string | null;
  createdAt: Date;
};

export type PaidActivityRow = {
  _id: Types.ObjectId | string;
  actorName?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
};

export type InvoiceForActivity = Pick<
  IInvoice,
  "status" | "paidAt" | "amountCents" | "paymentProvider" | "providerPaymentId"
> & {
  _id: Types.ObjectId | string;
  offlinePayment?: IInvoice["offlinePayment"];
  providerOrderId?: string | null;
  paymentProviderAccountRef?: Types.ObjectId | null;
  posCharge?: Pick<NonNullable<IInvoice["posCharge"]>, "startedAt" | "status"> | null;
};

export interface MergeActivityInput {
  invoice: InvoiceForActivity;
  emails: EmailRow[];
  texts: TextRow[];
  inferredEmails: EmailRow[];
  inferredTexts: TextRow[];
  events: EventRow[];
  paidActivity: PaidActivityRow | null;
  userNames: Map<string, string>;
  /** Customer visits recorded on the public payment pages. */
  visitCount?: number;
}

function detailEntry(
  detail: IInvoicePaymentDetail | null | undefined,
): InvoicePaymentDetailEntry | null {
  if (!detail?.label) return null;
  return {
    channel: detail.channel ?? null,
    label: detail.label,
    entryMethod: detail.entryMethod ?? null,
    cardBrand: detail.cardBrand ?? null,
    last4: detail.last4 ?? null,
    wallet: detail.wallet ?? null,
    squareProduct: detail.squareProduct ?? null,
    receiptUrl: detail.receiptUrl ?? null,
  };
}

/** Best guess at who made the payment, from the channel and how the invoice was opened. */
export function describePayer(input: {
  channel: "in_person" | "online" | null;
  posChargeStarted: boolean;
  customerOpened: boolean;
  staffStartedCheckout: boolean;
}): string | null {
  if (input.channel === "in_person") {
    return input.posChargeStarted
      ? "Technician, Tap to Pay from the CRM"
      : "Taken in the Square app";
  }
  if (input.channel === "online") {
    if (input.customerOpened) return "Customer, through the payment link";
    if (input.staffStartedCheckout) return "Staff opened checkout";
    return "Online checkout";
  }
  return null;
}

function clip(value: string | null | undefined, max = PREVIEW_LENGTH): string | null {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function iso(value: Date): string {
  return new Date(value).toISOString();
}

function senderName(
  ref: Types.ObjectId | string | null | undefined,
  userNames: Map<string, string>,
): string {
  if (!ref) return "System";
  return userNames.get(String(ref)) || "Staff";
}

function emailEntry(
  row: EmailRow,
  userNames: Map<string, string>,
  inferred: boolean,
): InvoiceContactEntry {
  return {
    id: `email:${String(row._id)}`,
    kind: "email",
    to: row.toEmail || null,
    subject: clip(row.subject, 200),
    preview: clip(row.body),
    status: row.status,
    error: row.errorMessage?.trim() || null,
    actorName: senderName(row.createdByUserRef, userNames),
    createdAt: iso(row.createdAt),
    inferred,
  };
}

function textEntry(
  row: TextRow,
  userNames: Map<string, string>,
  inferred: boolean,
): InvoiceContactEntry {
  return {
    id: `text:${String(row._id)}`,
    kind: row.channel === "mms" ? "mms" : "sms",
    to: row.toNumber || null,
    subject: null,
    preview: clip(row.body),
    status: row.status,
    error: row.errorMessage?.trim() || null,
    actorName: senderName(row.createdByUserRef, userNames),
    createdAt: iso(row.createdAt),
    inferred,
  };
}

const CONTACT_KINDS = new Set<string>(INVOICE_CONTACT_EVENT_KINDS);
const PAYMENT_KINDS = new Set<string>(INVOICE_PAYMENT_EVENT_KINDS);

function byNewest<T extends { createdAt: string }>(a: T, b: T): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/** Builds the timeline from rows already loaded, newest first. */
export function mergeInvoiceActivity(
  input: MergeActivityInput,
): Omit<InvoiceActivity, "visits"> {
  const { invoice, userNames } = input;
  const contacts: InvoiceContactEntry[] = [];
  const seen = new Set<string>();
  const push = (entry: InvoiceContactEntry) => {
    if (seen.has(entry.id)) return;
    seen.add(entry.id);
    contacts.push(entry);
  };

  for (const row of input.emails) push(emailEntry(row, userNames, false));
  for (const row of input.texts) push(textEntry(row, userNames, false));
  for (const row of input.inferredEmails) push(emailEntry(row, userNames, true));
  for (const row of input.inferredTexts) push(textEntry(row, userNames, true));

  const payerContext = {
    posChargeStarted: Boolean(invoice.posCharge),
    customerOpened:
      (input.visitCount ?? 0) > 0 ||
      input.events.some(
        (event) => CONTACT_KINDS.has(event.kind) && event.actorKind === "customer",
      ),
    staffStartedCheckout: input.events.some(
      (event) => event.kind === "checkout_started" && event.actorKind === "staff",
    ),
  };
  const payments: InvoicePaymentEntry[] = [];
  for (const event of input.events) {
    if (CONTACT_KINDS.has(event.kind)) {
      push({
        id: `event:${String(event._id)}`,
        kind: event.kind as InvoiceContactKind,
        to: null,
        subject: null,
        preview: null,
        status: null,
        error: null,
        actorName: event.actorName || "Customer",
        createdAt: iso(event.createdAt),
        inferred: false,
      });
    } else if (PAYMENT_KINDS.has(event.kind)) {
      const detail = detailEntry(event.paymentDetail);
      payments.push({
        id: `event:${String(event._id)}`,
        kind: event.kind as InvoicePaymentEntry["kind"],
        method: event.method ?? null,
        provider: event.provider ?? null,
        amountCents: event.amountCents ?? null,
        reason: event.reason ?? null,
        providerPaymentId: event.providerPaymentId ?? null,
        detail,
        payer: detail ? describePayer({ channel: detail.channel, ...payerContext }) : null,
        actorName: event.actorName || "System",
        createdAt: iso(event.createdAt),
        inferred: false,
      });
    }
  }

  const hasSuccess = payments.some((entry) => entry.kind === "payment_succeeded");
  if (invoice.status === "paid" && !hasSuccess) {
    const offline = invoice.offlinePayment?.method ?? null;
    const paidAt = input.paidActivity?.createdAt ?? invoice.paidAt;
    if (paidAt) {
      const provider =
        (input.paidActivity?.metadata?.provider as string | undefined) ??
        invoice.paymentProvider ??
        null;
      payments.push({
        id: input.paidActivity
          ? `activity:${String(input.paidActivity._id)}`
          : `invoice:${String(invoice._id)}:paid`,
        kind: "payment_succeeded",
        method: offline ?? (invoice.providerPaymentId ? "card" : null),
        provider: offline ? null : provider,
        amountCents: invoice.amountCents,
        reason:
          offline === "check" && invoice.offlinePayment?.checkNumber
            ? `Check #${invoice.offlinePayment.checkNumber}`
            : null,
        providerPaymentId: invoice.providerPaymentId ?? null,
        detail: null,
        payer: null,
        actorName:
          input.paidActivity?.actorName ||
          invoice.offlinePayment?.recordedByName ||
          "System",
        createdAt: iso(paidAt),
        inferred: true,
      });
    }
  }

  contacts.sort(byNewest);
  payments.sort(byNewest);
  return { contacts, payments };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function loadUserNames(
  refs: Array<Types.ObjectId | string | null | undefined>,
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      refs
        .filter((ref): ref is Types.ObjectId | string => Boolean(ref))
        .map(String)
        .filter((id) => Types.ObjectId.isValid(id)),
    ),
  ];
  if (ids.length === 0) return new Map();
  const users = await User.find({ _id: { $in: ids } })
    .select("first_name last_name email")
    .lean();
  return new Map(
    users.map((user) => [
      String(user._id),
      `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email || "Staff",
    ]),
  );
}

/** Invoices Square couldn't describe recently, so a slow Square doesn't slow every load. */
const backfillMisses = new Map<string, number>();
const BACKFILL_RETRY_MS = 10 * 60 * 1000;

export function resetPaymentBackfillCache(): void {
  backfillMisses.clear();
}

/**
 * Older paid Square invoices only have a guessed success row. Ask Square once how the
 * payment was taken and save it as a real event, so later loads read it from Mongo.
 * Returns the events list to use, with the new or updated success event in it.
 */
export async function backfillSquarePaymentEvent(input: {
  invoice: InvoiceForActivity;
  events: EventRow[];
  paidActivity: PaidActivityRow | null;
}): Promise<EventRow[]> {
  const { invoice, events, paidActivity } = input;
  const paymentId = invoice.providerPaymentId?.trim();
  if (invoice.status !== "paid" || invoice.paymentProvider !== "square" || !paymentId) {
    return events;
  }
  if (invoice.offlinePayment?.method) return events;
  const success = events.find(
    (event) => event.kind === "payment_succeeded" && event.providerPaymentId === paymentId,
  );
  if (success?.paymentDetail) return events;
  if (!success && events.some((event) => event.kind === "payment_succeeded")) return events;

  const key = String(invoice._id);
  const missedAt = backfillMisses.get(key);
  if (missedAt && Date.now() - missedAt < BACKFILL_RETRY_MS) return events;

  const found = await squarePaymentLookup.find({
    paymentId,
    orderId: invoice.providerOrderId ?? null,
    accountRef: invoice.paymentProviderAccountRef ?? null,
  });
  if (!found) {
    backfillMisses.set(key, Date.now());
    return events;
  }
  backfillMisses.delete(key);

  try {
    if (success) {
      const method = canRefineMethod(success.method) ? found.method : success.method;
      await InvoiceEvent.updateOne(
        { _id: success._id },
        { $set: { paymentDetail: found.detail, method } },
      );
      return events.map((event) =>
        event === success ? { ...event, paymentDetail: found.detail, method } : event,
      );
    }

    const at = paidActivity?.createdAt ?? invoice.paidAt ?? new Date();
    const doc = {
      invoiceRef: new Types.ObjectId(key),
      kind: "payment_succeeded" as const,
      method: found.method,
      provider: "square",
      amountCents: invoice.amountCents,
      providerPaymentId: paymentId,
      providerOrderId: invoice.providerOrderId ?? null,
      paymentDetail: found.detail,
      actorKind: "system" as const,
      actorName: paidActivity?.actorName || "System",
      source: "crm" as const,
      sourceEventId: paymentSourceEventId(key, "square", paymentId, "paid") ?? undefined,
      createdAt: new Date(at),
      updatedAt: new Date(),
    };
    const [created] = await InvoiceEvent.create([doc], { timestamps: false });
    return [
      ...events,
      {
        _id: created?._id ?? new Types.ObjectId(),
        ...doc,
      },
    ];
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) {
      return InvoiceEvent.find({ invoiceRef: new Types.ObjectId(key) })
        .sort({ createdAt: -1 })
        .limit(ROW_LIMIT)
        .lean<EventRow[]>();
    }
    console.error("[invoice-activity] could not save Square payment details", err);
    return events;
  }
}

const EMAIL_FIELDS = "toEmail subject body status errorMessage createdByUserRef createdAt";
const TEXT_FIELDS = "channel toNumber body status errorMessage createdByUserRef createdAt";

export async function loadInvoiceActivity(
  invoice: InvoiceForActivity & {
    number: string;
    customerRef?: Types.ObjectId | null;
    issuedAt?: Date | null;
    createdAt?: Date;
  },
): Promise<InvoiceActivity> {
  const invoiceRef = new Types.ObjectId(String(invoice._id));
  const issuedAt = invoice.issuedAt ?? invoice.createdAt ?? new Date(0);
  const since = new Date(new Date(issuedAt).getTime() - ISSUE_SLACK_MS);
  const numberPattern = invoice.number?.trim()
    ? new RegExp(escapeRegex(invoice.number.trim()), "i")
    : null;

  const inferredBase = invoice.customerRef && numberPattern
    ? {
        customerRef: invoice.customerRef,
        direction: "outbound" as const,
        invoiceRef: null,
        createdAt: { $gte: since },
      }
    : null;

  const [emails, texts, inferredEmails, inferredTexts, loadedEvents, paidActivity, visits] =
    await Promise.all([
      EmailCommunication.find({ invoiceRef, direction: "outbound" })
        .sort({ createdAt: -1 })
        .limit(ROW_LIMIT)
        .select(EMAIL_FIELDS)
        .lean<EmailRow[]>(),
      TwilioCommunication.find({
        invoiceRef,
        direction: "outbound",
        channel: { $in: ["sms", "mms"] },
      })
        .sort({ createdAt: -1 })
        .limit(ROW_LIMIT)
        .select(TEXT_FIELDS)
        .lean<TextRow[]>(),
      inferredBase && numberPattern
        ? EmailCommunication.find({
            ...inferredBase,
            $or: [{ subject: numberPattern }, { body: numberPattern }],
          })
            .sort({ createdAt: -1 })
            .limit(INFERRED_LIMIT)
            .select(EMAIL_FIELDS)
            .lean<EmailRow[]>()
        : Promise.resolve([] as EmailRow[]),
      inferredBase && numberPattern
        ? TwilioCommunication.find({
            ...inferredBase,
            channel: { $in: ["sms", "mms"] },
            body: numberPattern,
          })
            .sort({ createdAt: -1 })
            .limit(INFERRED_LIMIT)
            .select(TEXT_FIELDS)
            .lean<TextRow[]>()
        : Promise.resolve([] as TextRow[]),
      InvoiceEvent.find({ invoiceRef })
        .sort({ createdAt: -1 })
        .limit(ROW_LIMIT)
        .lean<EventRow[]>(),
      invoice.status === "paid"
        ? CustomerActivity.findOne({
            entityType: "invoice",
            entityId: String(invoice._id),
            category: "payment",
            action: "paid",
          })
            .sort({ createdAt: -1 })
            .select("actorName metadata createdAt")
            .lean<PaidActivityRow | null>()
        : Promise.resolve(null),
      listJourneyVisitsForInvoice(invoiceRef),
    ]);

  const [userNames, events] = await Promise.all([
    loadUserNames([
      ...emails.map((row) => row.createdByUserRef),
      ...texts.map((row) => row.createdByUserRef),
      ...inferredEmails.map((row) => row.createdByUserRef),
      ...inferredTexts.map((row) => row.createdByUserRef),
    ]),
    backfillSquarePaymentEvent({ invoice, events: loadedEvents, paidActivity }),
  ]);
  for (const event of events) {
    if (
      PAYMENT_KINDS.has(event.kind) &&
      event.provider === "square" &&
      event.providerPaymentId &&
      !event.paymentDetail
    ) {
      enrichSquarePaymentEventAsync(event._id);
    }
  }

  const merged = mergeInvoiceActivity({
    invoice,
    emails,
    texts,
    inferredEmails,
    inferredTexts,
    events,
    paidActivity,
    userNames,
    visitCount: visits.length,
  });
  return {
    contacts: foldOpensIntoVisits(merged.contacts, visits),
    payments: merged.payments,
    visits,
  };
}
