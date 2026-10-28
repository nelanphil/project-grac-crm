import { Types } from "mongoose";
import { Invoice, type IInvoice } from "../models/mongo/Invoice";
import { getAdapter, resolveCheckoutProviderForInvoice } from "../payments/registry";
import type {
  PaymentProviderAdapter,
  RetrievedProviderPayment,
} from "../payments/types";
import { logNotificationAsync } from "./notification.service";
import {
  getPaymentProviderAccountById,
  type PaymentAccountWithSecrets,
} from "./paymentProvider.service";
import { settleInvoicePayment } from "./invoiceSettlement.service";

/** How long after Tap to Pay starts a matching Square payment is still accepted. */
export const POS_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;
const POS_MATCH_LEAD_MS = 2 * 60 * 1000;
const RECONCILE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
/** Leave fresh charges to the callback page before the job looks at them. */
const RECONCILE_GRACE_MS = 3 * 60 * 1000;

export type PosTransactionCheck =
  | { status: "paid"; payment: RetrievedProviderPayment }
  | { status: "pending" }
  | { status: "failed" }
  | { status: "mismatch"; message: string }
  | { status: "unavailable"; message: string };

export type PosReconcileOutcome =
  | { status: "paid"; payment: RetrievedProviderPayment; invoice: IInvoice }
  | { status: "would_pay"; payment: RetrievedProviderPayment }
  | { status: "pending" }
  | { status: "failed" }
  | { status: "needs_review"; reason: string; candidates: RetrievedProviderPayment[] }
  | { status: "not_found" }
  | { status: "skipped"; reason: string };

type SquareAccount = {
  adapter: PaymentProviderAdapter;
  account: PaymentAccountWithSecrets;
};

type ReconcileActor = {
  actorType?: "user" | "system";
  actorUserId?: string | null;
  actorName?: string | null;
};

/** Payment IDs and order IDs already recorded on a different invoice. */
export const posLookups = {
  async linkedElsewhere(
    invoiceId: string,
    payments: RetrievedProviderPayment[],
  ): Promise<Set<string>> {
    const paymentIds = payments
      .map((p) => p.providerPaymentId)
      .filter((id): id is string => Boolean(id));
    const orderIds = payments
      .map((p) => p.providerOrderId)
      .filter((id): id is string => Boolean(id));
    if (paymentIds.length === 0 && orderIds.length === 0) return new Set();
    const rows = await Invoice.find({
      _id: { $ne: new Types.ObjectId(invoiceId) },
      status: "paid",
      $or: [
        ...(paymentIds.length ? [{ providerPaymentId: { $in: paymentIds } }] : []),
        ...(orderIds.length ? [{ providerOrderId: { $in: orderIds } }] : []),
      ],
    })
      .select("providerPaymentId providerOrderId")
      .lean();
    const linked = new Set<string>();
    for (const row of rows) {
      if (row.providerPaymentId) linked.add(row.providerPaymentId);
      if (row.providerOrderId) linked.add(row.providerOrderId);
    }
    return linked;
  },

  async competingCharges(invoice: IInvoice, start: Date): Promise<number> {
    return Invoice.countDocuments({
      _id: { $ne: invoice._id },
      status: { $nin: ["paid", "void"] },
      amountCents: invoice.amountCents,
      "posCharge.status": { $in: ["pending", "needs_review"] },
      "posCharge.startedAt": {
        $gte: new Date(start.getTime() - POS_MATCH_WINDOW_MS),
        $lte: new Date(start.getTime() + POS_MATCH_WINDOW_MS),
      },
    });
  },
};

/**
 * The charge pays the invoice: same amount before tip, or, when the Square order names
 * this invoice, the invoice amount plus only the tax Square added on its side.
 */
export function paymentCoversInvoice(
  payment: RetrievedProviderPayment,
  invoice: Pick<IInvoice, "_id" | "amountCents">,
): boolean {
  if (payment.amountCents == null) return false;
  if (payment.amountCents === invoice.amountCents) return true;
  const named = payment.invoiceIds.includes(String(invoice._id));
  const tax = payment.taxCents ?? 0;
  return named && tax > 0 && payment.amountCents - tax === invoice.amountCents;
}

function isLinked(payment: RetrievedProviderPayment, linked: Set<string>): boolean {
  return Boolean(
    (payment.providerPaymentId && linked.has(payment.providerPaymentId)) ||
      (payment.providerOrderId && linked.has(payment.providerOrderId)),
  );
}

/** Square location the charge was started on, falling back to the account's location. */
function chargeLocation(invoice: IInvoice, account: PaymentAccountWithSecrets): string {
  return invoice.posCharge?.locationId || account.account.locationId || "";
}

/**
 * Looks up a Square Point of Sale transaction and checks it paid this invoice: completed,
 * same amount before tip, same location, and not already recorded on another invoice.
 */
export async function checkPosTransaction(input: {
  invoice: IInvoice;
  adapter: PaymentProviderAdapter;
  account: PaymentAccountWithSecrets;
  transactionId: string;
}): Promise<PosTransactionCheck> {
  const { invoice, adapter, account, transactionId } = input;
  let retrieved: RetrievedProviderPayment | null = null;
  if (adapter.retrieveOrder) {
    retrieved = await adapter.retrieveOrder(account, transactionId).catch(() => null);
  }
  if (!retrieved && adapter.retrievePayment) {
    retrieved = await adapter.retrievePayment(account, transactionId).catch(() => null);
  }
  if (!retrieved) {
    return { status: "unavailable", message: "Could not retrieve payment from Square" };
  }
  if (retrieved.status === "pending") return { status: "pending" };
  if (retrieved.status !== "paid") return { status: "failed" };
  if (!paymentCoversInvoice(retrieved, invoice)) {
    return {
      status: "mismatch",
      message: "Square charge amount does not match this invoice.",
    };
  }
  const locationId = chargeLocation(invoice, account);
  if (!locationId || retrieved.locationId !== locationId) {
    return {
      status: "mismatch",
      message: "Square charge location does not match this account.",
    };
  }
  const linked = await posLookups.linkedElsewhere(String(invoice._id), [retrieved]);
  if (isLinked(retrieved, linked)) {
    return {
      status: "mismatch",
      message: "This Square payment is already recorded on another invoice.",
    };
  }
  return {
    status: "paid",
    payment: {
      ...retrieved,
      providerOrderId: retrieved.providerOrderId || transactionId,
    },
  };
}

export async function resolvePosSquareAccount(
  invoice: IInvoice,
): Promise<SquareAccount | null> {
  const ref = invoice.posCharge?.accountRef ?? invoice.paymentProviderAccountRef;
  if (ref) {
    const account = await getPaymentProviderAccountById(String(ref));
    if (account?.account.provider === "square") {
      return { adapter: getAdapter("square"), account };
    }
  }
  try {
    const resolved = await resolveCheckoutProviderForInvoice(invoice.customerRef);
    return resolved.adapter.name === "square" ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * Picks the Square payment that settles a Tap to Pay charge with no saved transaction:
 * one completed payment for the invoice amount in the window, preferring one whose note
 * names the invoice. Returns review when more than one could be it.
 */
export async function matchPosPayment(input: {
  invoice: IInvoice;
  payments: RetrievedProviderPayment[];
  start: Date;
}): Promise<
  | { status: "match"; payment: RetrievedProviderPayment }
  | { status: "none" }
  | { status: "review"; reason: string; candidates: RetrievedProviderPayment[] }
> {
  const { invoice, start } = input;
  const invoiceId = String(invoice._id);
  const sameAmount = input.payments.filter(
    (payment) => payment.status === "paid" && paymentCoversInvoice(payment, invoice),
  );
  if (sameAmount.length === 0) return { status: "none" };

  const linked = await posLookups.linkedElsewhere(invoiceId, sameAmount);
  const open = sameAmount.filter((payment) => !isLinked(payment, linked));
  if (open.length === 0) return { status: "none" };

  const named = open.filter((payment) => payment.invoiceIds.includes(invoiceId));
  if (named.length === 1) return { status: "match", payment: named[0] };
  if (named.length > 1) {
    return {
      status: "review",
      reason: "More than one Square payment names this invoice.",
      candidates: named,
    };
  }

  const unnamed = open.filter((payment) => payment.invoiceIds.length === 0);
  if (unnamed.length === 0) return { status: "none" };
  if (unnamed.length > 1) {
    return {
      status: "review",
      reason: "More than one Square payment matches this amount and time.",
      candidates: unnamed,
    };
  }
  if ((await posLookups.competingCharges(invoice, start)) > 0) {
    return {
      status: "review",
      reason: "Another open Tap to Pay charge has the same amount and time.",
      candidates: unnamed,
    };
  }
  return { status: "match", payment: unnamed[0] };
}

/** Holds a Tap to Pay charge for staff and leaves one notification per reason. */
export async function flagPosChargeForReview(
  invoice: IInvoice,
  reason: string,
): Promise<void> {
  if (!invoice.posCharge) return;
  const alreadyFlagged =
    invoice.posCharge.status === "needs_review" &&
    invoice.posCharge.reviewReason === reason;
  invoice.posCharge.status = "needs_review";
  invoice.posCharge.reviewReason = reason;
  invoice.posCharge.lastCheckedAt = new Date();
  invoice.markModified("posCharge");
  await invoice.save();
  if (alreadyFlagged) return;
  logNotificationAsync({
    entityType: "invoice",
    action: "updated",
    entityId: String(invoice._id),
    customerRef: invoice.customerRef ?? null,
    summary: `Tap to Pay on invoice ${invoice.number} needs review: ${reason}`,
    actorType: "system",
    actorUserId: null,
    actorName: "System",
  });
}

/**
 * Checks Square for the payment behind an invoice's Tap to Pay charge and settles the
 * invoice when one payment clearly matches. With `apply: false` nothing is written.
 */
export async function reconcilePosCharge(
  invoice: IInvoice,
  options: {
    apply?: boolean;
    actor?: ReconcileActor;
    apiBase?: string;
    /** When the invoice has no recorded charge, search from this time. */
    startedAt?: Date;
    now?: Date;
  } = {},
): Promise<PosReconcileOutcome> {
  const apply = options.apply !== false;
  const now = options.now ?? new Date();
  if (invoice.status === "paid") return { status: "skipped", reason: "Invoice is already paid." };
  if (invoice.status === "void") return { status: "skipped", reason: "Invoice is void." };

  const square = await resolvePosSquareAccount(invoice);
  if (!square) {
    return { status: "skipped", reason: "No Square account is connected for this invoice." };
  }
  const { adapter, account } = square;
  const settle = async (payment: RetrievedProviderPayment): Promise<PosReconcileOutcome> => {
    if (!apply) return { status: "would_pay", payment };
    const [paid] = await settleInvoicePayment({
      invoices: [invoice],
      providerPaymentId: payment.providerPaymentId,
      providerOrderId: payment.providerOrderId,
      actor: options.actor ?? { actorType: "system", actorName: "Square sync" },
      apiBase: options.apiBase,
    });
    return { status: "paid", payment, invoice: paid ?? invoice };
  };
  const touch = async () => {
    if (!apply || !invoice.posCharge) return;
    invoice.posCharge.lastCheckedAt = now;
    invoice.markModified("posCharge");
    await invoice.save();
  };

  const transactionId = invoice.posCharge?.transactionId?.trim();
  if (transactionId) {
    const check = await checkPosTransaction({ invoice, adapter, account, transactionId });
    if (check.status === "paid") return settle(check.payment);
    if (check.status === "pending" || check.status === "unavailable") {
      await touch();
      return { status: "pending" };
    }
    if (check.status === "failed") {
      if (apply && invoice.posCharge) {
        invoice.posCharge.status = "failed";
        invoice.posCharge.lastCheckedAt = now;
        invoice.markModified("posCharge");
        await invoice.save();
      }
      return { status: "failed" };
    }
    if (apply) await flagPosChargeForReview(invoice, check.message);
    return { status: "needs_review", reason: check.message, candidates: [] };
  }

  if (!adapter.listPayments) {
    return { status: "skipped", reason: "This payment provider cannot list payments." };
  }
  const locationId = chargeLocation(invoice, account);
  if (!locationId) {
    return { status: "skipped", reason: "Square location ID is not configured." };
  }
  const start = invoice.posCharge?.startedAt ?? options.startedAt ?? invoice.updatedAt;
  const windowEnd = new Date(start.getTime() + POS_MATCH_WINDOW_MS);
  const payments = await adapter.listPayments(account, {
    beginTime: new Date(start.getTime() - POS_MATCH_LEAD_MS),
    endTime: windowEnd < now ? windowEnd : now,
    locationId,
  });
  const match = await matchPosPayment({ invoice, payments, start });
  if (match.status === "match") return settle(match.payment);
  if (match.status === "review") {
    if (apply) await flagPosChargeForReview(invoice, match.reason);
    return { status: "needs_review", reason: match.reason, candidates: match.candidates };
  }
  if (windowEnd < now && invoice.posCharge?.status === "pending") {
    const reason = "No matching Square payment was found.";
    if (apply) await flagPosChargeForReview(invoice, reason);
    return { status: "needs_review", reason, candidates: [] };
  }
  await touch();
  return { status: "not_found" };
}

/** Runs reconcile now for open Tap to Pay charges a Square payment could belong to. */
export async function reconcileOpenPosCharges(input: {
  amountCents: number;
  locationId?: string;
  apiBase?: string;
  now?: Date;
}): Promise<number> {
  const now = input.now ?? new Date();
  const invoices = await Invoice.find({
    status: { $nin: ["paid", "void"] },
    amountCents: input.amountCents,
    "posCharge.status": "pending",
    "posCharge.startedAt": { $gte: new Date(now.getTime() - POS_MATCH_WINDOW_MS) },
    ...(input.locationId ? { "posCharge.locationId": input.locationId } : {}),
  }).limit(5);
  let paid = 0;
  for (const invoice of invoices) {
    const outcome = await reconcilePosCharge(invoice, { apiBase: input.apiBase, now });
    if (outcome.status === "paid") paid += 1;
  }
  return paid;
}

export async function runPosReconcileJob(now = new Date()): Promise<{
  checked: number;
  paid: number;
  review: number;
}> {
  const invoices = await Invoice.find({
    status: { $nin: ["paid", "void"] },
    "posCharge.status": "pending",
    "posCharge.startedAt": {
      $gte: new Date(now.getTime() - RECONCILE_LOOKBACK_MS),
      $lte: new Date(now.getTime() - RECONCILE_GRACE_MS),
    },
  })
    .sort({ "posCharge.lastCheckedAt": 1 })
    .limit(25);
  let paid = 0;
  let review = 0;
  for (const invoice of invoices) {
    try {
      const outcome = await reconcilePosCharge(invoice, { now });
      if (outcome.status === "paid") paid += 1;
      if (outcome.status === "needs_review") review += 1;
    } catch (err) {
      console.error(`[pos-reconcile] invoice ${invoice.number} failed:`, err);
    }
  }
  return { checked: invoices.length, paid, review };
}
