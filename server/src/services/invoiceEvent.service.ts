import mongoose, { Types } from "mongoose";
import type { ActivityActorKind, ActivitySource } from "../models/mongo/CustomerActivity";
import {
  IInvoiceEvent,
  InvoiceEvent,
  InvoiceEventKind,
  InvoicePaymentMethod,
} from "../models/mongo/InvoiceEvent";
import type { IInvoice } from "../models/mongo/Invoice";
import { User } from "../models/mongo/User";

export const INVOICE_OPEN_THROTTLE_MS = 15 * 60 * 1000;

export interface RecordInvoiceEventInput {
  invoiceRef: Types.ObjectId | string;
  customerRef?: Types.ObjectId | string | null;
  kind: InvoiceEventKind;
  method?: InvoicePaymentMethod | null;
  provider?: string | null;
  amountCents?: number | null;
  reason?: string | null;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  actorKind?: ActivityActorKind;
  actorUserId?: string | null;
  actorName?: string | null;
  source?: ActivitySource;
  sourceEventId?: string | null;
  /** Skip when the same kind was recorded for this invoice inside the window. */
  throttleMs?: number;
}

function toObjectId(
  value: Types.ObjectId | string | null | undefined,
): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;
  return mongoose.isValidObjectId(value) ? new Types.ObjectId(value) : null;
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: number }).code === 11000
  );
}

function defaultActorName(kind: ActivityActorKind): string {
  if (kind === "customer") return "Customer";
  if (kind === "staff") return "Staff";
  return "System";
}

async function resolveActorName(
  input: RecordInvoiceEventInput,
  actorKind: ActivityActorKind,
): Promise<string> {
  const explicit = input.actorName?.trim();
  if (explicit) return explicit;
  const userId = toObjectId(input.actorUserId ?? null);
  if (userId) {
    const user = await User.findById(userId)
      .select("first_name last_name email")
      .lean();
    const name = user
      ? `${user.first_name ?? ""} ${user.last_name ?? ""}`.trim() || user.email
      : "";
    if (name) return name;
  }
  return defaultActorName(actorKind);
}

/** One provider payment can settle several invoices, so the key includes the invoice. */
export function paymentSourceEventId(
  invoiceId: Types.ObjectId | string,
  provider: string | null | undefined,
  paymentId: string | null | undefined,
  status: string,
): string | null {
  const id = paymentId?.trim();
  if (!id) return null;
  return `${provider || "unknown"}:${id}:${status}:${String(invoiceId)}`;
}

const POS_CHARGE_RECENT_MS = 2 * 60 * 60 * 1000;

export function inferPaymentMethod(
  invoice: Pick<IInvoice, "amountCents" | "offlinePayment" | "posCharge">,
  payment: {
    providerPaymentId?: string | null;
    providerOrderId?: string | null;
    paidByCustomer?: boolean;
  },
  now: Date = new Date(),
): InvoicePaymentMethod {
  const offline = invoice.offlinePayment;
  if (
    offline?.method &&
    offline.recordedAt &&
    now.getTime() - new Date(offline.recordedAt).getTime() < 5 * 60 * 1000
  ) {
    return offline.method;
  }
  const pos = invoice.posCharge;
  if (pos) {
    const sameTransaction =
      Boolean(pos.transactionId) &&
      (pos.transactionId === payment.providerPaymentId ||
        pos.transactionId === payment.providerOrderId);
    const recent =
      pos.startedAt && now.getTime() - new Date(pos.startedAt).getTime() < POS_CHARGE_RECENT_MS;
    if (sameTransaction || recent) return "tap_to_pay";
  }
  if (invoice.amountCents === 0) return "zero_total";
  if (payment.providerPaymentId || payment.providerOrderId || payment.paidByCustomer) {
    return "card";
  }
  return "manual";
}

export async function recordInvoiceEvent(
  input: RecordInvoiceEventInput,
): Promise<IInvoiceEvent | null> {
  const invoiceRef = toObjectId(input.invoiceRef);
  if (!invoiceRef) return null;

  try {
    if (input.throttleMs && input.throttleMs > 0) {
      const recent = await InvoiceEvent.exists({
        invoiceRef,
        kind: input.kind,
        createdAt: { $gte: new Date(Date.now() - input.throttleMs) },
      });
      if (recent) return null;
    }

    const actorKind = input.actorKind ?? (input.actorUserId ? "staff" : "system");
    const actorName = await resolveActorName(input, actorKind);
    const sourceEventId = input.sourceEventId?.trim() || undefined;
    const created = await InvoiceEvent.create({
      invoiceRef,
      customerRef: toObjectId(input.customerRef ?? null),
      kind: input.kind,
      method: input.method ?? null,
      provider: input.provider ?? null,
      amountCents:
        typeof input.amountCents === "number" ? input.amountCents : null,
      reason: input.reason?.trim().slice(0, 500) || null,
      providerPaymentId: input.providerPaymentId ?? null,
      providerOrderId: input.providerOrderId ?? null,
      actorKind,
      actorUserId: toObjectId(input.actorUserId ?? null),
      actorName,
      source: input.source ?? "crm",
      ...(sourceEventId ? { sourceEventId } : {}),
    });
    if (created?.provider === "square" && created.providerPaymentId && !created.paymentDetail) {
      // Loaded on demand so recording an event doesn't pull in the payment provider stack.
      void import("./invoicePaymentDetail.service").then((detail) =>
        detail.enrichSquarePaymentEventAsync(created._id as Types.ObjectId),
      );
    }
    return created;
  } catch (err) {
    if (isDuplicateKey(err)) return null;
    console.error("[invoice-event] failed to record", err);
    return null;
  }
}

export function recordInvoiceEventAsync(input: RecordInvoiceEventInput): void {
  void recordInvoiceEvent(input);
}
