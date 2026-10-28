import { Types } from "mongoose";
import { CheckoutLink } from "../models/mongo/CheckoutLink";
import { Invoice } from "../models/mongo/Invoice";
import {
  IJourneyEvent,
  JOURNEY_MAX_EVENTS,
  JourneyEntry,
  JourneyOutcome,
  PaymentJourneySession,
} from "../models/mongo/PaymentJourneySession";
import {
  JOURNEY_SNAPSHOT_MAX_BYTES,
  JOURNEY_SNAPSHOTS_PER_VISIT,
  PaymentJourneySnapshot,
} from "../models/mongo/PaymentJourneySnapshot";
import type {
  JourneyBatchInput,
  JourneyEventInput,
  JourneySnapshotInput,
} from "../schemas/paymentJourney.schema";
import { findCheckoutKeyByPayCode, findCustomerByCheckoutKey } from "../utils/checkoutKey";
import { hashPayToken } from "../utils/payToken";
import { isScopedCheckoutKey } from "./checkoutLink.service";

const DETAIL_MAX = 500;
const MESSAGE_MAX = 300;
const UNSCOPED_INVOICE_LIMIT = 20;
/** Client clocks drift; anything further off than this is replaced with server time. */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;
/** A visit with no terminal step and no events for this long counts as abandoned. */
export const JOURNEY_IDLE_MS = 30 * 60 * 1000;

const OPEN_STATUSES = ["open", "draft", "failed"];

export type ResolvedJourneyLink = {
  invoiceRefs: Types.ObjectId[];
  customerRef: Types.ObjectId | null;
};

type InvoiceRow = { _id: Types.ObjectId; customerRef?: Types.ObjectId | null };

function fromInvoices(rows: InvoiceRow[]): ResolvedJourneyLink | null {
  if (rows.length === 0) return null;
  return {
    invoiceRefs: rows.map((row) => row._id),
    customerRef: rows.find((row) => row.customerRef)?.customerRef ?? null,
  };
}

async function openInvoicesForCustomer(
  customerRef: Types.ObjectId,
): Promise<ResolvedJourneyLink> {
  const rows = await Invoice.find({ customerRef, status: { $in: OPEN_STATUSES } })
    .sort({ issuedAt: -1 })
    .limit(UNSCOPED_INVOICE_LIMIT)
    .select("_id customerRef")
    .lean<InvoiceRow[]>();
  return { invoiceRefs: rows.map((row) => row._id), customerRef };
}

async function resolveCheckoutKey(key: string): Promise<ResolvedJourneyLink | null> {
  if (isScopedCheckoutKey(key)) {
    const link = await CheckoutLink.findOne({ tokenHash: hashPayToken(key) })
      .select("customerRef items")
      .lean();
    if (!link) return null;
    const ids = link.items
      .filter((item) => item.kind === "invoice" && Types.ObjectId.isValid(item.id))
      .map((item) => new Types.ObjectId(item.id));
    return { invoiceRefs: ids, customerRef: link.customerRef ?? null };
  }
  const customer = await findCustomerByCheckoutKey(key);
  if (!customer) return null;
  return openInvoicesForCustomer(customer._id as Types.ObjectId);
}

/**
 * Turns the link the customer is on into the invoices it covers. Only links the server
 * issued resolve, so arbitrary posts cannot attach steps to an invoice.
 */
export async function resolveJourneyLink(
  link: JourneyBatchInput["link"],
): Promise<ResolvedJourneyLink | null> {
  const resolved: ResolvedJourneyLink[] = [];
  if (link.checkoutKey) {
    const result = await resolveCheckoutKey(link.checkoutKey);
    if (result) resolved.push(result);
  }
  if (link.payCode && resolved.length === 0) {
    const key = await findCheckoutKeyByPayCode(link.payCode);
    const result = key ? await resolveCheckoutKey(key) : null;
    if (result) resolved.push(result);
  }
  if (link.payToken) {
    const rows = await Invoice.find({ payTokenHash: hashPayToken(link.payToken) })
      .select("_id customerRef")
      .lean<InvoiceRow[]>();
    const result = fromInvoices(rows);
    if (result) resolved.push(result);
  }
  if (link.viewToken) {
    const row = await Invoice.findOne({ viewToken: link.viewToken })
      .select("_id customerRef")
      .lean<InvoiceRow | null>();
    const result = row ? fromInvoices([row]) : null;
    if (result) resolved.push(result);
  }
  if (link.invoiceId && resolved.length === 0) {
    // The return page only knows the invoice id; accept it once a checkout was started.
    const row = await Invoice.findOne({
      _id: link.invoiceId,
      status: { $ne: "void" },
      providerCheckoutId: { $nin: [null, ""] },
    })
      .select("_id customerRef")
      .lean<InvoiceRow | null>();
    const result = row ? fromInvoices([row]) : null;
    if (result) resolved.push(result);
  }
  if (resolved.length === 0) return null;
  const refs = new Map<string, Types.ObjectId>();
  for (const result of resolved) {
    for (const ref of result.invoiceRefs) refs.set(String(ref), ref);
  }
  return {
    invoiceRefs: [...refs.values()],
    customerRef: resolved.find((result) => result.customerRef)?.customerRef ?? null,
  };
}

function clip(value: string | undefined, max: number): string {
  const text = (value ?? "").replaceAll("\u0000", "").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
}

export function sanitizeJourneyEvents(
  events: JourneyEventInput[],
  now: Date = new Date(),
): IJourneyEvent[] {
  return events.map((event) => {
    const t =
      Math.abs(event.t - now.getTime()) > CLOCK_SKEW_MS ? now : new Date(event.t);
    const meta: NonNullable<IJourneyEvent["meta"]> = {};
    if (typeof event.meta?.status === "number") meta.status = event.meta.status;
    if (typeof event.meta?.durationMs === "number") {
      meta.durationMs = Math.round(event.meta.durationMs);
    }
    if (event.meta?.message) meta.message = clip(event.meta.message, MESSAGE_MAX);
    return {
      t,
      type: event.type,
      detail: clip(event.detail, DETAIL_MAX),
      meta: Object.keys(meta).length > 0 ? meta : null,
    };
  });
}

const ERROR_STEPS = new Set([
  "link_invalid",
  "checkout_start_failed",
  "discount_rejected",
  "confirm_error",
  "pdf_failed",
]);

function stepName(event: IJourneyEvent): string {
  return event.detail.split(/[\s:]/, 1)[0] ?? "";
}

/**
 * Reads the visit outcome from the steps. A confirmed payment always wins; otherwise
 * the latest of failed, redirected, or error decides.
 */
export function deriveJourneyOutcome(
  previous: { outcome?: JourneyOutcome | null; lastError?: string | null },
  events: IJourneyEvent[],
): { outcome: JourneyOutcome | null; lastError: string | null } {
  let outcome = previous.outcome ?? null;
  let lastError = previous.lastError ?? null;
  for (const event of events) {
    const isStep = event.type === "step";
    const name = isStep ? stepName(event) : "";
    const failedApi =
      event.type === "api" && typeof event.meta?.status === "number" &&
      (event.meta.status === 0 || event.meta.status >= 400);
    if (event.type === "error" || (isStep && ERROR_STEPS.has(name)) || failedApi) {
      lastError = clip(event.meta?.message || event.detail, MESSAGE_MAX) || lastError;
    }
    if (outcome === "paid") continue;
    if (isStep && name === "payment_confirmed") outcome = "paid";
    else if (isStep && name === "payment_failed_shown") outcome = "failed";
    else if (isStep && name === "redirect_to_square") outcome = "redirected_to_square";
    else if (event.type === "error" || (isStep && ERROR_STEPS.has(name) && name !== "discount_rejected")) {
      outcome = "error";
    }
  }
  return { outcome, lastError };
}

export function describeDevice(userAgent: string): string {
  const ua = userAgent || "";
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "Mac"
        : /Windows/.test(ua)
          ? "Windows"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "";
  const kind = /Mobi|iPhone|Android.*Mobile/.test(ua)
    ? "Phone"
    : /iPad|Tablet|Android/.test(ua)
      ? "Tablet"
      : "Desktop";
  return [kind, os, browser].filter(Boolean).join(" · ");
}

export async function ingestJourneyBatch(input: {
  batch: JourneyBatchInput;
  userAgent: string;
  ip: string | null;
  now?: Date;
  resolved?: ResolvedJourneyLink | null;
}): Promise<{ stored: boolean }> {
  const now = input.now ?? new Date();
  const resolved =
    input.resolved === undefined ? await resolveJourneyLink(input.batch.link) : input.resolved;
  if (!resolved || resolved.invoiceRefs.length === 0) return { stored: false };

  const events = sanitizeJourneyEvents(input.batch.events, now);
  const existing = await PaymentJourneySession.findOne({ sessionId: input.batch.sessionId })
    .select("outcome lastError customerRef")
    .lean();
  if (
    existing?.customerRef &&
    resolved.customerRef &&
    String(existing.customerRef) !== String(resolved.customerRef)
  ) {
    return { stored: false };
  }
  const derived = deriveJourneyOutcome(existing ?? {}, events);
  const firstAt = events[0]?.t ?? now;
  const lastAt = events[events.length - 1]?.t ?? now;

  await PaymentJourneySession.updateOne(
    { sessionId: input.batch.sessionId },
    {
      $setOnInsert: {
        sessionId: input.batch.sessionId,
        entry: input.batch.entry,
        userAgent: clip(input.userAgent, 400),
        device: describeDevice(input.userAgent),
        ip: input.ip,
        startedAt: firstAt,
      },
      $set: {
        lastEventAt: lastAt > now ? now : lastAt,
        outcome: derived.outcome,
        lastError: derived.lastError,
        ...(resolved.customerRef ? { customerRef: resolved.customerRef } : {}),
      },
      $addToSet: {
        invoiceRefs: { $each: resolved.invoiceRefs },
        pages: input.batch.entry,
      },
      $inc: { eventCount: events.length },
      ...(events.length > 0
        ? { $push: { events: { $each: events, $slice: -JOURNEY_MAX_EVENTS } } }
        : {}),
    },
    { upsert: true },
  );
  return { stored: true };
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];

export type JourneySnapshotResult =
  | { stored: true; snapshotId: string }
  | { stored: false; reason: "unknown_link" | "limit" | "not_jpeg" | "too_large" };

/**
 * Saves a picture of a payment page and adds a `snapshot_taken` step to the visit.
 * Same link rules as step batches; at most four pictures per visit.
 */
export async function ingestJourneySnapshot(input: {
  snapshot: JourneySnapshotInput;
  userAgent: string;
  ip: string | null;
  now?: Date;
}): Promise<JourneySnapshotResult> {
  const now = input.now ?? new Date();
  const { snapshot } = input;
  const data = Buffer.from(snapshot.image, "base64");
  if (data.length > JOURNEY_SNAPSHOT_MAX_BYTES) return { stored: false, reason: "too_large" };
  if (!JPEG_MAGIC.every((byte, index) => data[index] === byte)) {
    return { stored: false, reason: "not_jpeg" };
  }

  const resolved = await resolveJourneyLink(snapshot.link);
  if (!resolved || resolved.invoiceRefs.length === 0) {
    return { stored: false, reason: "unknown_link" };
  }
  const taken = await PaymentJourneySnapshot.countDocuments({ sessionId: snapshot.sessionId });
  if (taken >= JOURNEY_SNAPSHOTS_PER_VISIT) return { stored: false, reason: "limit" };

  const snapshotId = new Types.ObjectId();
  const takenAtMs = new Date(snapshot.takenAt).getTime();
  const result = await ingestJourneyBatch({
    batch: {
      sessionId: snapshot.sessionId,
      entry: snapshot.entry,
      link: snapshot.link,
      events: [
        {
          t: takenAtMs,
          type: "step",
          detail: `snapshot_taken: ${snapshotId} ${snapshot.step}`,
        },
      ],
    },
    userAgent: input.userAgent,
    ip: input.ip,
    now,
    resolved,
  });
  if (!result.stored) return { stored: false, reason: "unknown_link" };

  await PaymentJourneySnapshot.create({
    _id: snapshotId,
    sessionId: snapshot.sessionId,
    invoiceRefs: resolved.invoiceRefs,
    step: snapshot.step,
    takenAt: Math.abs(takenAtMs - now.getTime()) > CLOCK_SKEW_MS ? now : new Date(takenAtMs),
    mime: "image/jpeg",
    data,
    width: snapshot.width,
    height: snapshot.height,
  });
  return { stored: true, snapshotId: String(snapshotId) };
}

/** The picture bytes, only when the visit it belongs to covers this invoice. */
export async function getJourneySnapshotForInvoice(
  invoiceId: Types.ObjectId | string,
  sessionId: string,
  snapshotId: string,
): Promise<{ mime: string; data: Buffer } | null> {
  if (!Types.ObjectId.isValid(snapshotId)) return null;
  const row = await PaymentJourneySnapshot.findOne({
    _id: new Types.ObjectId(snapshotId),
    sessionId,
    invoiceRefs: new Types.ObjectId(String(invoiceId)),
  })
    .select("mime data")
    .lean<{ mime?: string; data: Buffer | { buffer: Buffer } } | null>();
  if (!row) return null;
  const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data.buffer);
  return { mime: row.mime || "image/jpeg", data };
}

export type JourneyVisitOutcome = JourneyOutcome | "abandoned" | "active";

export interface JourneyVisitSummary {
  sessionId: string;
  entry: JourneyEntry;
  pages: JourneyEntry[];
  device: string;
  startedAt: string;
  lastEventAt: string;
  durationMs: number;
  outcome: JourneyVisitOutcome;
  lastError: string | null;
  eventCount: number;
}

export interface JourneyVisitDetail extends JourneyVisitSummary {
  userAgent: string;
  events: Array<{
    t: string;
    type: IJourneyEvent["type"];
    detail: string;
    meta: IJourneyEvent["meta"];
  }>;
}

type SessionRow = {
  sessionId: string;
  entry: JourneyEntry;
  pages?: JourneyEntry[];
  device?: string;
  userAgent?: string;
  startedAt: Date;
  lastEventAt: Date;
  outcome?: JourneyOutcome | null;
  lastError?: string | null;
  eventCount?: number;
  events?: IJourneyEvent[];
};

export function summarizeJourney(row: SessionRow, now: Date = new Date()): JourneyVisitSummary {
  const started = new Date(row.startedAt);
  const last = new Date(row.lastEventAt);
  const idle = now.getTime() - last.getTime() > JOURNEY_IDLE_MS;
  return {
    sessionId: row.sessionId,
    entry: row.entry,
    pages: row.pages ?? [row.entry],
    device: row.device ?? "",
    startedAt: started.toISOString(),
    lastEventAt: last.toISOString(),
    durationMs: Math.max(0, last.getTime() - started.getTime()),
    outcome: row.outcome ?? (idle ? "abandoned" : "active"),
    lastError: row.lastError ?? null,
    eventCount: row.eventCount ?? row.events?.length ?? 0,
  };
}

const VISIT_LIMIT = 50;

export async function listJourneyVisitsForInvoice(
  invoiceId: Types.ObjectId | string,
): Promise<JourneyVisitSummary[]> {
  const rows = await PaymentJourneySession.find({
    invoiceRefs: new Types.ObjectId(String(invoiceId)),
  })
    .sort({ startedAt: -1 })
    .limit(VISIT_LIMIT)
    .select("-events -ip")
    .lean<SessionRow[]>();
  const now = new Date();
  return rows.map((row) => summarizeJourney(row, now));
}

export async function getJourneyVisitForInvoice(
  invoiceId: Types.ObjectId | string,
  sessionId: string,
): Promise<JourneyVisitDetail | null> {
  const row = await PaymentJourneySession.findOne({
    sessionId,
    invoiceRefs: new Types.ObjectId(String(invoiceId)),
  })
    .select("-ip")
    .lean<SessionRow | null>();
  if (!row) return null;
  return {
    ...summarizeJourney(row),
    userAgent: row.userAgent ?? "",
    events: (row.events ?? []).map((event) => ({
      t: new Date(event.t).toISOString(),
      type: event.type,
      detail: event.detail,
      meta: event.meta ?? null,
    })),
  };
}
