import { Types } from "mongoose";
import {
  IPaymentProviderAccount,
  PAYMENT_PROVIDERS,
  PaymentProviderAccount,
  PaymentProviderName,
} from "../models/mongo/PaymentProviderAccount";
import { Invoice, IInvoice } from "../models/mongo/Invoice";
import { InvoiceEvent } from "../models/mongo/InvoiceEvent";
import { WorkOrder } from "../models/mongo/WorkOrder";
import {
  Customer,
  excludeDeletedCustomerRefs,
  loadDeletedCustomerIds,
} from "../models/mongo/Customer";
import { CustomerContact, activeContactFilter } from "../models/mongo/CustomerContact";
import { User } from "../models/mongo/User";
import { getAdapter } from "../payments/registry";
import { describeProviderPayment } from "../payments/paymentDetail";
import {
  LayerTransactionStatus,
  ProviderLayerTransaction,
} from "../payments/types";
import {
  decryptPaymentSecrets,
  PaymentAccountWithSecrets,
} from "./paymentProvider.service";
import { ensureFreshSquareAccessToken } from "./squareOAuth.service";
import {
  dollarsToCents,
  ensureOpenInvoiceForWorkOrder,
} from "./invoice.service";
import { settleInvoicePayment } from "./invoiceSettlement.service";
import {
  mergeMongoFilters,
  ownerWorkOrderMongoFilter,
} from "./financialsOwnerScope";
import { legacyUserIdForOwnerName } from "./legacyLoginOwners";

export const LAYER_TITLES: Record<PaymentProviderName, string> = {
  square: "Square",
  stripe: "Stripe",
  paypal: "PayPal",
};

export type LayerMatchStatus = "matched" | "possible_match" | "unmatched";

export interface LayerMatchedRecord {
  recordType: "invoice" | "work_order";
  invoiceId: string | null;
  workOrderId: string | null;
  number: string;
  workOrderNumber?: string | null;
  customerName: string;
  amountCents: number;
  status: string;
  date: string | null;
  detailUrl: string;
  workOrderDetailUrl?: string | null;
}

export interface LayerMatchCandidate {
  recordType: "invoice" | "work_order";
  invoiceId: string | null;
  workOrderId: string | null;
  number: string;
  customerName: string;
  amountCents: number;
  status: string;
  date: string | null;
  reason: string;
  detailUrl: string;
}

export interface PaymentLayerTransactionRow {
  provider: PaymentProviderName;
  accountId: string;
  providerPaymentId: string;
  providerOrderId: string | null;
  createdAt: string;
  status: LayerTransactionStatus;
  providerStatus: string;
  grossCents: number;
  amountCents: number;
  tipCents: number;
  taxCents: number;
  feeCents: number;
  refundedCents: number;
  netCents: number;
  currency: string;
  methodLabel: string;
  channel: "in_person" | "online" | null;
  cardBrand: string | null;
  last4: string | null;
  receiptUrl: string | null;
  payerName: string | null;
  payerEmail: string | null;
  payerPhone: string | null;
  customerName: string | null;
  note: string | null;
  matchStatus: LayerMatchStatus;
  matchReason: string | null;
  matchedRecord: LayerMatchedRecord | null;
  candidates: LayerMatchCandidate[];
}

export interface PaymentLayerPnLSummary {
  totalCount: number;
  paidCount: number;
  failedCount: number;
  refundedCount: number;
  grossCents: number;
  amountCents: number;
  tipCents: number;
  taxCents: number;
  feeCents: number;
  refundedCents: number;
  netCents: number;
  matchedCount: number;
  matchedCents: number;
  matchedNetCents: number;
  possibleMatchCount: number;
  possibleMatchCents: number;
  unmatchedCount: number;
  unmatchedCents: number;
  unmatchedNetCents: number;
}

export interface PaymentLayerReportItem {
  accountId: string;
  provider: PaymentProviderName;
  layerTitle: string;
  friendlyName: string;
  environment: "sandbox" | "production";
  isDefault: boolean;
  owner: {
    id: string;
    name: string;
  } | null;
  syncError: string | null;
  pnl: PaymentLayerPnLSummary;
  transactions: PaymentLayerTransactionRow[];
}

export interface CrmInvoiceForMatch {
  _id: string;
  number: string;
  status: string;
  amountCents: number;
  issuedAt: string | null;
  paidAt: string | null;
  paymentProvider: string | null;
  paymentProviderAccountRef: string | null;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  posTransactionId: string | null;
  customerRef: string | null;
  customerName: string;
  customerEmails: string[];
  workOrderRef: string | null;
  workOrderNumber: string | null;
}

export interface CrmWorkOrderForMatch {
  _id: string;
  number: string;
  status: string;
  paid: boolean;
  amountCents: number;
  date: string | null;
  customerRef: string | null;
  customerName: string;
  customerEmails: string[];
  invoiceId: string | null;
  invoiceNumber: string | null;
}

const CANDIDATE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

function normalizePersonName(value?: string | null): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmail(value?: string | null): string {
  return (value ?? "").trim().toLowerCase();
}

function amountsMatch(
  tx: Pick<ProviderLayerTransaction, "amountCents" | "grossCents" | "taxCents">,
  targetCents: number,
): boolean {
  if (targetCents <= 0) return false;
  if (tx.amountCents === targetCents || tx.grossCents === targetCents) {
    return true;
  }
  if (tx.taxCents > 0 && tx.amountCents - tx.taxCents === targetCents) {
    return true;
  }
  return false;
}

function withinDays(aIso?: string | null, bIso?: string | null, windowMs = CANDIDATE_WINDOW_MS): boolean {
  if (!aIso || !bIso) return false;
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= windowMs;
}

/**
 * Pure matching + P&L calculation engine for a single payment layer account.
 */
export function matchLayerTransactionsAndComputePnL(input: {
  accountId: string;
  provider: PaymentProviderName;
  transactions: ProviderLayerTransaction[];
  invoices: CrmInvoiceForMatch[];
  workOrders: CrmWorkOrderForMatch[];
  eventPaymentToInvoiceId?: ReadonlyMap<string, string>;
}): {
  pnl: PaymentLayerPnLSummary;
  transactions: PaymentLayerTransactionRow[];
} {
  const {
    accountId,
    provider,
    transactions,
    invoices,
    workOrders,
    eventPaymentToInvoiceId = new Map<string, string>(),
  } = input;

  const byPaymentId = new Map<string, CrmInvoiceForMatch>();
  const byOrderId = new Map<string, CrmInvoiceForMatch>();
  const byPosTxId = new Map<string, CrmInvoiceForMatch>();
  const byInvoiceId = new Map<string, CrmInvoiceForMatch>();
  const byInvoiceNumber = new Map<string, CrmInvoiceForMatch>();

  for (const inv of invoices) {
    byInvoiceId.set(inv._id, inv);
    byInvoiceNumber.set(inv.number.toUpperCase(), inv);
    if (inv.providerPaymentId) byPaymentId.set(inv.providerPaymentId, inv);
    if (inv.providerOrderId) byOrderId.set(inv.providerOrderId, inv);
    if (inv.posTransactionId) byPosTxId.set(inv.posTransactionId, inv);
  }

  const claimedInvoiceIds = new Set<string>();
  const claimedWorkOrderIds = new Set<string>();

  // Pass 1: find all exact matches first so claimed records aren't suggested as candidates for other rows
  const exactMatches = new Map<
    string,
    { invoice: CrmInvoiceForMatch; reason: string }
  >();

  for (const tx of transactions) {
    let matchedInv: CrmInvoiceForMatch | undefined;
    let reason = "";

    if (tx.providerPaymentId && byPaymentId.has(tx.providerPaymentId)) {
      matchedInv = byPaymentId.get(tx.providerPaymentId);
      reason = "Matched via payment ID";
    } else if (tx.providerOrderId && byOrderId.has(tx.providerOrderId)) {
      matchedInv = byOrderId.get(tx.providerOrderId);
      reason = "Matched via order ID";
    } else if (
      (tx.providerPaymentId && byPosTxId.has(tx.providerPaymentId)) ||
      (tx.providerOrderId && byPosTxId.has(tx.providerOrderId))
    ) {
      matchedInv =
        byPosTxId.get(tx.providerPaymentId) ??
        (tx.providerOrderId ? byPosTxId.get(tx.providerOrderId) : undefined);
      reason = "Matched via POS transaction ID";
    } else if (tx.invoiceIds.length > 0) {
      for (const token of tx.invoiceIds) {
        const found =
          byInvoiceId.get(token) ?? byInvoiceNumber.get(token.toUpperCase());
        if (found) {
          matchedInv = found;
          reason = "Matched via invoice reference in payment note";
          break;
        }
      }
    }

    if (!matchedInv) {
      const evInvId =
        eventPaymentToInvoiceId.get(tx.providerPaymentId) ??
        (tx.providerOrderId
          ? eventPaymentToInvoiceId.get(tx.providerOrderId)
          : undefined);
      if (evInvId && byInvoiceId.has(evInvId)) {
        matchedInv = byInvoiceId.get(evInvId);
        reason = "Matched via invoice payment event";
      }
    }

    if (matchedInv) {
      exactMatches.set(tx.providerPaymentId, { invoice: matchedInv, reason });
      claimedInvoiceIds.add(matchedInv._id);
      if (matchedInv.workOrderRef) {
        claimedWorkOrderIds.add(matchedInv.workOrderRef);
      }
    }
  }

  // Pass 2: build rows and compute P&L
  const pnl: PaymentLayerPnLSummary = {
    totalCount: transactions.length,
    paidCount: 0,
    failedCount: 0,
    refundedCount: 0,
    grossCents: 0,
    amountCents: 0,
    tipCents: 0,
    taxCents: 0,
    feeCents: 0,
    refundedCents: 0,
    netCents: 0,
    matchedCount: 0,
    matchedCents: 0,
    matchedNetCents: 0,
    possibleMatchCount: 0,
    possibleMatchCents: 0,
    unmatchedCount: 0,
    unmatchedCents: 0,
    unmatchedNetCents: 0,
  };

  const rows: PaymentLayerTransactionRow[] = [];

  for (const tx of transactions) {
    const described = describeProviderPayment(provider, tx.detail);
    const exact = exactMatches.get(tx.providerPaymentId);

    let matchStatus: LayerMatchStatus = "unmatched";
    let matchReason: string | null = null;
    let matchedRecord: LayerMatchedRecord | null = null;
    const candidates: LayerMatchCandidate[] = [];

    if (exact) {
      matchStatus = "matched";
      matchReason = exact.reason;
      const inv = exact.invoice;
      matchedRecord = {
        recordType: "invoice",
        invoiceId: inv._id,
        workOrderId: inv.workOrderRef,
        number: inv.number,
        workOrderNumber: inv.workOrderNumber,
        customerName: inv.customerName,
        amountCents: inv.amountCents,
        status: inv.status,
        date: inv.paidAt || inv.issuedAt,
        detailUrl: `/dashboard/orders/detail?id=${inv._id}`,
        workOrderDetailUrl: inv.workOrderRef
          ? `/dashboard/work-orders/detail?id=${inv.workOrderRef}`
          : null,
      };
    } else if (tx.status !== "failed") {
      const txEmail = normalizeEmail(tx.payerEmail);
      const txName = normalizePersonName(tx.payerName);
      const scored: Array<{ score: number; candidate: LayerMatchCandidate }> = [];

      for (const inv of invoices) {
        if (claimedInvoiceIds.has(inv._id) || inv.status === "void") continue;
        // Skip invoices already linked to a different provider payment ID
        if (
          inv.providerPaymentId &&
          inv.providerPaymentId !== tx.providerPaymentId
        ) {
          continue;
        }

        const sameAmount = amountsMatch(tx, inv.amountCents);
        const nearDate =
          withinDays(tx.createdAt, inv.paidAt) ||
          withinDays(tx.createdAt, inv.issuedAt);
        const emailMatch =
          Boolean(txEmail) &&
          inv.customerEmails.some((e) => normalizeEmail(e) === txEmail);
        const nameMatch =
          Boolean(txName) &&
          txName.length >= 4 &&
          normalizePersonName(inv.customerName) === txName;

        let score = 0;
        const reasons: string[] = [];
        if (sameAmount) {
          score += 50;
          reasons.push("Exact amount");
        }
        if (emailMatch) {
          score += 45;
          reasons.push("Matching email");
        } else if (nameMatch) {
          score += 35;
          reasons.push("Matching customer name");
        }
        if (nearDate) {
          score += 20;
          reasons.push("Close date");
        }

        if (score >= 50) {
          scored.push({
            score,
            candidate: {
              recordType: "invoice",
              invoiceId: inv._id,
              workOrderId: inv.workOrderRef,
              number: inv.number,
              customerName: inv.customerName,
              amountCents: inv.amountCents,
              status: inv.status,
              date: inv.issuedAt,
              reason: reasons.join(" · "),
              detailUrl: `/dashboard/orders/detail?id=${inv._id}`,
            },
          });
        }
      }

      for (const wo of workOrders) {
        if (claimedWorkOrderIds.has(wo._id) || wo.amountCents <= 0) continue;
        if (wo.invoiceId && claimedInvoiceIds.has(wo.invoiceId)) continue;
        // Avoid duplicating if the work order's invoice is already in scored
        if (
          wo.invoiceId &&
          scored.some((s) => s.candidate.invoiceId === wo.invoiceId)
        ) {
          continue;
        }

        const sameAmount = amountsMatch(tx, wo.amountCents);
        const nearDate = withinDays(tx.createdAt, wo.date);
        const emailMatch =
          Boolean(txEmail) &&
          wo.customerEmails.some((e) => normalizeEmail(e) === txEmail);
        const nameMatch =
          Boolean(txName) &&
          txName.length >= 4 &&
          normalizePersonName(wo.customerName) === txName;

        let score = 0;
        const reasons: string[] = [];
        if (sameAmount) {
          score += 45;
          reasons.push("Exact amount");
        }
        if (emailMatch) {
          score += 40;
          reasons.push("Matching email");
        } else if (nameMatch) {
          score += 30;
          reasons.push("Matching customer name");
        }
        if (nearDate) {
          score += 20;
          reasons.push("Close service date");
        }

        if (score >= 45) {
          scored.push({
            score,
            candidate: {
              recordType: "work_order",
              invoiceId: wo.invoiceId,
              workOrderId: wo._id,
              number: wo.number,
              customerName: wo.customerName,
              amountCents: wo.amountCents,
              status: wo.status,
              date: wo.date,
              reason: reasons.join(" · "),
              detailUrl: `/dashboard/work-orders/detail?id=${wo._id}`,
            },
          });
        }
      }

      scored.sort((a, b) => b.score - a.score);
      for (const item of scored.slice(0, 3)) {
        candidates.push(item.candidate);
      }

      if (candidates.length > 0) {
        matchStatus = "possible_match";
        matchReason = candidates[0]!.reason;
      }
    }

    const countsForRevenue = tx.status === "paid" || tx.status === "refunded";
    if (tx.status === "paid") pnl.paidCount += 1;
    else if (tx.status === "failed") pnl.failedCount += 1;
    else if (tx.status === "refunded") pnl.refundedCount += 1;

    if (countsForRevenue) {
      pnl.grossCents += tx.grossCents;
      pnl.amountCents += tx.amountCents;
      pnl.tipCents += tx.tipCents;
      pnl.taxCents += tx.taxCents;
      pnl.feeCents += tx.feeCents;
      pnl.refundedCents += tx.refundedCents;
      pnl.netCents += tx.netCents;

      const effectiveRevenue = Math.max(0, tx.grossCents - tx.refundedCents);
      if (matchStatus === "matched") {
        pnl.matchedCount += 1;
        pnl.matchedCents += effectiveRevenue;
        pnl.matchedNetCents += tx.netCents;
      } else if (matchStatus === "possible_match") {
        pnl.possibleMatchCount += 1;
        pnl.possibleMatchCents += effectiveRevenue;
      } else {
        pnl.unmatchedCount += 1;
        pnl.unmatchedCents += effectiveRevenue;
        pnl.unmatchedNetCents += tx.netCents;
      }
    }

    rows.push({
      provider,
      accountId,
      providerPaymentId: tx.providerPaymentId,
      providerOrderId: tx.providerOrderId ?? null,
      createdAt: tx.createdAt,
      status: tx.status,
      providerStatus: tx.providerStatus,
      grossCents: tx.grossCents,
      amountCents: tx.amountCents,
      tipCents: tx.tipCents,
      taxCents: tx.taxCents,
      feeCents: tx.feeCents,
      refundedCents: tx.refundedCents,
      netCents: tx.netCents,
      currency: tx.currency || "USD",
      methodLabel: described.label,
      channel: described.channel,
      cardBrand: tx.detail?.cardBrand ?? null,
      last4: tx.detail?.last4 ?? null,
      receiptUrl: tx.detail?.receiptUrl ?? null,
      payerName: tx.payerName ?? null,
      payerEmail: tx.payerEmail ?? null,
      payerPhone: tx.payerPhone ?? null,
      customerName:
        matchedRecord?.customerName ||
        candidates[0]?.customerName ||
        tx.payerName ||
        null,
      note: tx.note ?? null,
      matchStatus,
      matchReason,
      matchedRecord,
      candidates,
    });
  }

  return { pnl, transactions: rows };
}

function customerDisplayName(customer: {
  accountName?: string;
  first?: string;
  last?: string;
  legacyId?: number;
}): string {
  const account = (customer.accountName ?? "").trim();
  if (account) return account;
  const full = `${customer.first ?? ""} ${customer.last ?? ""}`.trim();
  if (full) return full;
  return customer.legacyId ? `Customer #${customer.legacyId}` : "Unnamed Customer";
}

async function prepareAccountWithSecrets(
  doc: IPaymentProviderAccount,
): Promise<PaymentAccountWithSecrets> {
  let account = doc;
  if (account.provider === "square") {
    try {
      account = await ensureFreshSquareAccessToken(account);
    } catch {
      // If OAuth refresh fails, still attempt with current token or surface error on list
    }
  }
  return {
    account,
    secrets: decryptPaymentSecrets(account),
  };
}

/**
 * Fallback synthesis of transactions from CRM Invoices/InvoiceEvents when the external
 * payment provider API is unreachable or missing credentials in dev/sandbox.
 */
function fallbackTransactionsFromInvoices(
  provider: PaymentProviderName,
  accountId: string,
  invoices: CrmInvoiceForMatch[],
  from?: Date | null,
  to?: Date | null,
): ProviderLayerTransaction[] {
  const rows: ProviderLayerTransaction[] = [];
  for (const inv of invoices) {
    const matchesAccount =
      inv.paymentProviderAccountRef === accountId ||
      (!inv.paymentProviderAccountRef && inv.paymentProvider === provider);
    if (!matchesAccount) continue;
    if (inv.status !== "paid" && !inv.providerPaymentId && !inv.posTransactionId) {
      continue;
    }
    const ts = inv.paidAt || inv.issuedAt;
    if (ts) {
      const d = new Date(ts);
      if (from && d < from) continue;
      if (to && d > to) continue;
    }
    const paymentId =
      inv.providerPaymentId || inv.posTransactionId || `crm-inv-${inv._id}`;
    rows.push({
      provider,
      providerPaymentId: paymentId,
      providerOrderId: inv.providerOrderId,
      createdAt: ts || new Date().toISOString(),
      status: inv.status === "paid" ? "paid" : "pending",
      providerStatus: inv.status.toUpperCase(),
      grossCents: inv.amountCents,
      amountCents: inv.amountCents,
      tipCents: 0,
      taxCents: 0,
      feeCents: 0,
      refundedCents: 0,
      netCents: inv.status === "paid" ? inv.amountCents : 0,
      currency: "USD",
      payerName: inv.customerName || null,
      payerEmail: inv.customerEmails[0] ?? null,
      payerPhone: null,
      note: `Invoice ${inv.number}`,
      invoiceIds: [inv._id],
      locationId: null,
    });
  }
  return rows;
}

/**
 * Builds the Payment Layer P&L & Transaction Reconciliation report for the active layers in scope.
 */
export async function buildPaymentLayersReport(input: {
  /** Null only when a Super Admin views "All owners". */
  ownerId: string | null;
  canViewAllOwners: boolean;
  from?: Date | null;
  to?: Date | null;
}): Promise<PaymentLayerReportItem[]> {
  const { ownerId, canViewAllOwners, from, to } = input;

  // Enforce strict owner isolation: if not super-admin and no ownerId, return empty.
  if (!ownerId && !canViewAllOwners) {
    return [];
  }

  const accountFilter: Record<string, unknown> = { isActive: true };
  if (ownerId) {
    accountFilter.ownerUserRef = new Types.ObjectId(ownerId);
  }

  const accountDocs = await PaymentProviderAccount.find(accountFilter).sort({
    provider: 1,
    isDefault: -1,
    friendlyName: 1,
  });

  if (accountDocs.length === 0) {
    return [];
  }

  const ownerIds = [
    ...new Set(
      accountDocs
        .map((a) => (a.ownerUserRef ? String(a.ownerUserRef) : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const owners =
    ownerIds.length > 0
      ? await User.find({ _id: { $in: ownerIds } })
          .select("first_name last_name email")
          .lean()
      : [];
  const ownerMap = new Map(
    owners.map((u) => [
      String(u._id),
      {
        id: String(u._id),
        name:
          `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim() ||
          u.email ||
          "Owner",
        firstName: u.first_name ?? "",
        lastName: u.last_name ?? "",
      },
    ]),
  );

  // Fetch live transactions for each active payment layer in parallel
  const fetchedPerAccount = await Promise.all(
    accountDocs.map(async (doc) => {
      const prepared = await prepareAccountWithSecrets(doc);
      const adapter = getAdapter(doc.provider);
      let liveTransactions: ProviderLayerTransaction[] = [];
      let syncError: string | null = null;

      if (adapter.listLayerTransactions) {
        try {
          liveTransactions = await adapter.listLayerTransactions(prepared, {
            beginTime: from ?? null,
            endTime: to ?? null,
          });
        } catch (err) {
          syncError =
            err instanceof Error
              ? err.message
              : `Could not fetch ${LAYER_TITLES[doc.provider]} transactions`;
        }
      } else {
        syncError = `${LAYER_TITLES[doc.provider]} transaction listing is not supported`;
      }

      return { doc, liveTransactions, syncError };
    }),
  );

  // Collect all payment/order/invoice IDs from live transactions so we also load any referenced CRM invoices
  const allPaymentIds = new Set<string>();
  const allOrderIds = new Set<string>();
  const allExplicitInvoiceIds = new Set<string>();

  for (const item of fetchedPerAccount) {
    for (const tx of item.liveTransactions) {
      if (tx.providerPaymentId) allPaymentIds.add(tx.providerPaymentId);
      if (tx.providerOrderId) allOrderIds.add(tx.providerOrderId);
      for (const invId of tx.invoiceIds) {
        if (Types.ObjectId.isValid(invId)) {
          allExplicitInvoiceIds.add(invId);
        }
      }
    }
  }

  const hideDeleted = excludeDeletedCustomerRefs(await loadDeletedCustomerIds());

  // Build owner customer & work order scope per owner (plus global when super-admin views all)
  const ownerCustomerFilter =
    ownerIds.length > 0 && !canViewAllOwners
      ? {
          deletedAt: null,
          mergedIntoRef: null,
          $or: [
            {
              ownerUserRef: {
                $in: ownerIds.map((id) => new Types.ObjectId(id)),
              },
            },
            ...ownerIds
              .map((id) => {
                const o = ownerMap.get(id);
                return o ? legacyUserIdForOwnerName(o.firstName, o.lastName) : null;
              })
              .filter((lid): lid is number => lid != null)
              .map((lid) => ({ userId: lid })),
          ],
        }
      : ownerId
        ? (() => {
            const o = ownerMap.get(ownerId);
            const lid = o
              ? legacyUserIdForOwnerName(o.firstName, o.lastName)
              : null;
            return {
              deletedAt: null,
              mergedIntoRef: null,
              $or: [
                { ownerUserRef: new Types.ObjectId(ownerId) },
                ...(lid != null ? [{ userId: lid }] : []),
              ],
            };
          })()
        : { deletedAt: null, mergedIntoRef: null };

  const scopedCustomers = await Customer.find(ownerCustomerFilter)
    .select("_id legacyId accountName first last email ownerUserRef userId")
    .lean();

  const scopedCustomerIds = scopedCustomers.map((c) => c._id as Types.ObjectId);
  const customerById = new Map(
    scopedCustomers.map((c) => [String(c._id), c]),
  );
  const customerByLegacyId = new Map<number, (typeof scopedCustomers)[number]>();
  for (const c of scopedCustomers) {
    if (typeof c.legacyId === "number") {
      customerByLegacyId.set(c.legacyId, c);
    }
  }

  // Expand date window by 14 days on each side when loading candidate CRM invoices/work orders
  const paddedFrom = from
    ? new Date(from.getTime() - CANDIDATE_WINDOW_MS)
    : undefined;
  const paddedTo = to
    ? new Date(to.getTime() + CANDIDATE_WINDOW_MS)
    : undefined;

  const woDateFilter: Record<string, unknown> = {};
  if (paddedFrom || paddedTo) {
    const range: Record<string, Date> = {};
    if (paddedFrom) range.$gte = paddedFrom;
    if (paddedTo) range.$lte = paddedTo;
    woDateFilter.$or = [{ date: range }, { createdAt: range }];
  }

  const singleOwnerLegacyId = ownerId
    ? (() => {
        const o = ownerMap.get(ownerId);
        return o ? legacyUserIdForOwnerName(o.firstName, o.lastName) : null;
      })()
    : null;

  const woScopeFilter = ownerId
    ? ownerWorkOrderMongoFilter(singleOwnerLegacyId, scopedCustomerIds)
    : {};

  const workOrders = await WorkOrder.find(
    mergeMongoFilters(woDateFilter, woScopeFilter, hideDeleted),
  )
    .select("_id number legacyId customerRef customerId customerName date createdAt completed paid total")
    .sort({ date: -1, createdAt: -1 })
    .limit(1000)
    .lean();

  const workOrderById = new Map(
    workOrders.map((wo) => [String(wo._id), wo]),
  );

  // Load invoices matching timeframe, scoped customers/work orders, or explicit payment IDs
  const invoiceOrClauses: Record<string, unknown>[] = [];
  if (allPaymentIds.size > 0) {
    invoiceOrClauses.push({
      providerPaymentId: { $in: [...allPaymentIds] },
    });
    invoiceOrClauses.push({
      "posCharge.transactionId": { $in: [...allPaymentIds] },
    });
  }
  if (allOrderIds.size > 0) {
    invoiceOrClauses.push({
      providerOrderId: { $in: [...allOrderIds] },
    });
    invoiceOrClauses.push({
      "posCharge.transactionId": { $in: [...allOrderIds] },
    });
  }
  if (allExplicitInvoiceIds.size > 0) {
    invoiceOrClauses.push({
      _id: { $in: [...allExplicitInvoiceIds].map((id) => new Types.ObjectId(id)) },
    });
  }

  const scopedInvoiceFilter: Record<string, unknown> = {};
  if (paddedFrom || paddedTo) {
    const range: Record<string, Date> = {};
    if (paddedFrom) range.$gte = paddedFrom;
    if (paddedTo) range.$lte = paddedTo;
    scopedInvoiceFilter.$or = [{ paidAt: range }, { issuedAt: range }, { createdAt: range }];
  }
  if (ownerId) {
    const woObjectIds = workOrders.map((w) => w._id as Types.ObjectId);
    const ownerAccountIds = accountDocs.map((a) => a._id as Types.ObjectId);
    scopedInvoiceFilter.$and = [
      {
        $or: [
          ...(scopedCustomerIds.length > 0
            ? [{ customerRef: { $in: scopedCustomerIds } }]
            : []),
          ...(woObjectIds.length > 0
            ? [{ workOrderRef: { $in: woObjectIds } }]
            : []),
          ...(ownerAccountIds.length > 0
            ? [{ paymentProviderAccountRef: { $in: ownerAccountIds } }]
            : []),
        ],
      },
    ];
  }
  invoiceOrClauses.push(scopedInvoiceFilter);

  const invoiceDocs = await Invoice.find(
    mergeMongoFilters({ $or: invoiceOrClauses }, hideDeleted),
  )
    .select(
      "_id number status amountCents issuedAt paidAt createdAt paymentProvider paymentProviderAccountRef providerPaymentId providerOrderId posCharge customerRef customerId workOrderRef serviceWorkOrderRef",
    )
    .sort({ paidAt: -1, issuedAt: -1, createdAt: -1 })
    .limit(1000)
    .lean();

  // Also check InvoiceEvents for any payment IDs
  const eventPaymentToInvoiceId = new Map<string, string>();
  if (allPaymentIds.size > 0 || allOrderIds.size > 0) {
    const events = await InvoiceEvent.find({
      $or: [
        ...(allPaymentIds.size > 0
          ? [{ providerPaymentId: { $in: [...allPaymentIds] } }]
          : []),
        ...(allOrderIds.size > 0
          ? [{ providerOrderId: { $in: [...allOrderIds] } }]
          : []),
      ],
    })
      .select("invoiceRef providerPaymentId providerOrderId")
      .lean();
    for (const ev of events) {
      if (ev.providerPaymentId) {
        eventPaymentToInvoiceId.set(ev.providerPaymentId, String(ev.invoiceRef));
      }
      if (ev.providerOrderId) {
        eventPaymentToInvoiceId.set(ev.providerOrderId, String(ev.invoiceRef));
      }
    }
  }

  // Load any missing customers & contacts for email/name matching
  const neededCustomerIds = new Set<string>();
  for (const inv of invoiceDocs) {
    if (inv.customerRef) neededCustomerIds.add(String(inv.customerRef));
  }
  for (const wo of workOrders) {
    if (wo.customerRef) neededCustomerIds.add(String(wo.customerRef));
  }
  const missingCustIds = [...neededCustomerIds].filter(
    (id) => !customerById.has(id) && Types.ObjectId.isValid(id),
  );
  if (missingCustIds.length > 0) {
    const extraCusts = await Customer.find({
      _id: { $in: missingCustIds.map((id) => new Types.ObjectId(id)) },
      deletedAt: null,
    })
      .select("_id legacyId accountName first last email ownerUserRef userId")
      .lean();
    for (const c of extraCusts) {
      customerById.set(String(c._id), c);
      if (typeof c.legacyId === "number") {
        customerByLegacyId.set(c.legacyId, c);
      }
    }
  }

  const allCustomerObjectIds = [...customerById.keys()]
    .filter((id) => Types.ObjectId.isValid(id))
    .map((id) => new Types.ObjectId(id));
  const contacts =
    allCustomerObjectIds.length > 0
      ? await CustomerContact.find({
          customerRef: { $in: allCustomerObjectIds },
          ...activeContactFilter,
        })
          .select("customerRef email")
          .lean()
      : [];
  const emailsByCustomerId = new Map<string, string[]>();
  for (const [cid, cust] of customerById.entries()) {
    const list: string[] = [];
    if (cust.email?.trim()) list.push(cust.email.trim().toLowerCase());
    emailsByCustomerId.set(cid, list);
  }
  for (const contact of contacts) {
    if (!contact.customerRef || !contact.email?.trim()) continue;
    const cid = String(contact.customerRef);
    const list = emailsByCustomerId.get(cid) ?? [];
    const normalized = contact.email.trim().toLowerCase();
    if (!list.includes(normalized)) list.push(normalized);
    emailsByCustomerId.set(cid, list);
  }

  // Load any missing work orders referenced by invoices
  const missingWoIds = invoiceDocs
    .map((inv) => inv.workOrderRef || inv.serviceWorkOrderRef)
    .filter(
      (ref): ref is Types.ObjectId =>
        Boolean(ref) && !workOrderById.has(String(ref)),
    );
  if (missingWoIds.length > 0) {
    const extraWos = await WorkOrder.find({ _id: { $in: missingWoIds } })
      .select("_id number legacyId customerRef customerId customerName date createdAt completed paid total")
      .lean();
    for (const wo of extraWos) {
      workOrderById.set(String(wo._id), wo);
    }
  }

  const invoiceByWorkOrderId = new Map<string, (typeof invoiceDocs)[number]>();
  for (const inv of invoiceDocs) {
    if (inv.workOrderRef && inv.status !== "void") {
      invoiceByWorkOrderId.set(String(inv.workOrderRef), inv);
    }
  }

  const formattedInvoices: CrmInvoiceForMatch[] = invoiceDocs.map((inv) => {
    const cust =
      (inv.customerRef ? customerById.get(String(inv.customerRef)) : undefined) ??
      (typeof inv.customerId === "number"
        ? customerByLegacyId.get(inv.customerId)
        : undefined);
    const cid = cust ? String(cust._id) : inv.customerRef ? String(inv.customerRef) : null;
    const customerName = cust
      ? customerDisplayName(cust)
      : inv.customerId
        ? `Customer #${inv.customerId}`
        : "Customer";
    const woRef = inv.workOrderRef || inv.serviceWorkOrderRef || null;
    const wo = woRef ? workOrderById.get(String(woRef)) : undefined;
    const woNumber = wo
      ? wo.number || (wo.legacyId ? `WO #${wo.legacyId}` : String(wo._id).slice(-6))
      : null;

    return {
      _id: String(inv._id),
      number: inv.number,
      status: inv.status,
      amountCents: inv.amountCents || 0,
      issuedAt: inv.issuedAt
        ? new Date(inv.issuedAt).toISOString()
        : inv.createdAt
          ? new Date(inv.createdAt).toISOString()
          : null,
      paidAt: inv.paidAt ? new Date(inv.paidAt).toISOString() : null,
      paymentProvider: inv.paymentProvider ?? null,
      paymentProviderAccountRef: inv.paymentProviderAccountRef
        ? String(inv.paymentProviderAccountRef)
        : null,
      providerPaymentId: inv.providerPaymentId ?? null,
      providerOrderId: inv.providerOrderId ?? null,
      posTransactionId: inv.posCharge?.transactionId ?? null,
      customerRef: cid,
      customerName,
      customerEmails: cid ? (emailsByCustomerId.get(cid) ?? []) : [],
      workOrderRef: woRef ? String(woRef) : null,
      workOrderNumber: woNumber,
    };
  });

  const formattedWorkOrders: CrmWorkOrderForMatch[] = workOrders.map((wo) => {
    const cust =
      (wo.customerRef ? customerById.get(String(wo.customerRef)) : undefined) ??
      (typeof wo.customerId === "number"
        ? customerByLegacyId.get(wo.customerId)
        : undefined);
    const cid = cust ? String(cust._id) : wo.customerRef ? String(wo.customerRef) : null;
    const customerName =
      wo.customerName?.trim() ||
      (cust ? customerDisplayName(cust) : wo.customerId ? `Customer #${wo.customerId}` : "Customer");
    const linkedInv = invoiceByWorkOrderId.get(String(wo._id));
    const dateVal = wo.date || wo.createdAt;

    return {
      _id: String(wo._id),
      number:
        wo.number ||
        (wo.legacyId ? `WO #${wo.legacyId}` : String(wo._id).slice(-6)),
      status: wo.completed ? "completed" : "open",
      paid: Boolean(wo.paid),
      amountCents: dollarsToCents(wo.total || 0),
      date: dateVal ? new Date(dateVal).toISOString() : null,
      customerRef: cid,
      customerName,
      customerEmails: cid ? (emailsByCustomerId.get(cid) ?? []) : [],
      invoiceId: linkedInv ? String(linkedInv._id) : null,
      invoiceNumber: linkedInv ? linkedInv.number : null,
    };
  });

  // Assemble the report item for each active payment layer account
  return fetchedPerAccount.map(({ doc, liveTransactions, syncError }) => {
    const accountId = String(doc._id);
    const ownerInfo = doc.ownerUserRef
      ? ownerMap.get(String(doc.ownerUserRef)) ?? null
      : null;

    const effectiveTransactions =
      liveTransactions.length > 0
        ? liveTransactions
        : fallbackTransactionsFromInvoices(
            doc.provider,
            accountId,
            formattedInvoices,
            from,
            to,
          );

    const { pnl, transactions } = matchLayerTransactionsAndComputePnL({
      accountId,
      provider: doc.provider,
      transactions: effectiveTransactions,
      invoices: formattedInvoices,
      workOrders: formattedWorkOrders,
      eventPaymentToInvoiceId,
    });

    return {
      accountId,
      provider: doc.provider,
      layerTitle: LAYER_TITLES[doc.provider] ?? doc.provider,
      friendlyName: doc.friendlyName,
      environment: doc.environment,
      isDefault: Boolean(doc.isDefault),
      owner: ownerInfo ? { id: ownerInfo.id, name: ownerInfo.name } : null,
      syncError,
      pnl,
      transactions,
    };
  });
}

/**
 * Searches open or unlinked CRM invoices and work orders for manual transaction linking.
 */
export async function findLinkCandidatesForOwner(input: {
  ownerId: string | null;
  canViewAllOwners: boolean;
  search?: string;
  amountCents?: number;
}): Promise<LayerMatchCandidate[]> {
  const { ownerId, canViewAllOwners, search = "", amountCents } = input;
  if (!ownerId && !canViewAllOwners) return [];

  const hideDeleted = excludeDeletedCustomerRefs(await loadDeletedCustomerIds());
  let customerIds: Types.ObjectId[] = [];
  let legacyUserId: number | null = null;

  if (ownerId && Types.ObjectId.isValid(ownerId)) {
    const owner = await User.findById(ownerId)
      .select("first_name last_name")
      .lean();
    if (owner) {
      legacyUserId = legacyUserIdForOwnerName(owner.first_name, owner.last_name);
      const custs = await Customer.find({
        deletedAt: null,
        mergedIntoRef: null,
        $or: [
          { ownerUserRef: owner._id },
          ...(legacyUserId != null ? [{ userId: legacyUserId }] : []),
        ],
      })
        .select("_id")
        .lean();
      customerIds = custs.map((c) => c._id as Types.ObjectId);
    }
  }

  const woScope = ownerId
    ? ownerWorkOrderMongoFilter(legacyUserId, customerIds)
    : {};

  const trimmed = search.trim();
  const re = trimmed
    ? new RegExp(trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    : null;

  const invFilter: Record<string, unknown> = {
    status: { $ne: "void" },
    $or: [{ providerPaymentId: null }, { providerPaymentId: { $exists: false } }],
  };
  if (ownerId && customerIds.length > 0) {
    invFilter.customerRef = { $in: customerIds };
  }
  if (re) {
    const matchingCusts = await Customer.find({
      deletedAt: null,
      $or: [{ accountName: re }, { first: re }, { last: re }],
    })
      .select("_id")
      .lean();
    invFilter.$and = [
      {
        $or: [
          { number: re },
          ...(matchingCusts.length > 0
            ? [{ customerRef: { $in: matchingCusts.map((c) => c._id) } }]
            : []),
        ],
      },
    ];
  }

  const invoices = await Invoice.find(mergeMongoFilters(invFilter, hideDeleted))
    .sort({ issuedAt: -1, createdAt: -1 })
    .limit(20)
    .lean();

  const custRefs = invoices
    .map((inv) => inv.customerRef)
    .filter((id): id is Types.ObjectId => Boolean(id));
  const custDocs =
    custRefs.length > 0
      ? await Customer.find({ _id: { $in: custRefs } })
          .select("_id accountName first last legacyId")
          .lean()
      : [];
  const custNameMap = new Map(
    custDocs.map((c) => [String(c._id), customerDisplayName(c)]),
  );

  const candidates: LayerMatchCandidate[] = invoices.map((inv) => ({
    recordType: "invoice",
    invoiceId: String(inv._id),
    workOrderId: inv.workOrderRef ? String(inv.workOrderRef) : null,
    number: inv.number,
    customerName:
      (inv.customerRef && custNameMap.get(String(inv.customerRef))) ||
      (inv.customerId ? `Customer #${inv.customerId}` : "Customer"),
    amountCents: inv.amountCents || 0,
    status: inv.status,
    date: inv.issuedAt ? new Date(inv.issuedAt).toISOString() : null,
    reason:
      amountCents && inv.amountCents === amountCents
        ? "Exact amount match"
        : "CRM Invoice",
    detailUrl: `/dashboard/orders/detail?id=${inv._id}`,
  }));

  // Also search recent completed/unpaid work orders
  const woFilter: Record<string, unknown> = {
    total: { $gt: 0 },
  };
  if (re) {
    woFilter.$or = [{ number: re }, { customerName: re }, { descPerform: re }];
  }
  const workOrders = await WorkOrder.find(
    mergeMongoFilters(woFilter, woScope, hideDeleted),
  )
    .sort({ date: -1, createdAt: -1 })
    .limit(15)
    .lean();

  for (const wo of workOrders) {
    const woId = String(wo._id);
    if (candidates.some((c) => c.workOrderId === woId)) continue;
    const woCents = dollarsToCents(wo.total || 0);
    candidates.push({
      recordType: "work_order",
      invoiceId: null,
      workOrderId: woId,
      number:
        wo.number ||
        (wo.legacyId ? `WO #${wo.legacyId}` : String(wo._id).slice(-6)),
      customerName:
        wo.customerName?.trim() ||
        (wo.customerId ? `Customer #${wo.customerId}` : "Customer"),
      amountCents: woCents,
      status: wo.completed ? "completed" : "open",
      date: wo.date ? new Date(wo.date).toISOString() : null,
      reason:
        amountCents && woCents === amountCents
          ? "Exact amount match"
          : "CRM Work Order",
      detailUrl: `/dashboard/work-orders/detail?id=${wo._id}`,
    });
  }

  if (amountCents) {
    candidates.sort((a, b) => {
      const aExact = a.amountCents === amountCents ? 1 : 0;
      const bExact = b.amountCents === amountCents ? 1 : 0;
      return bExact - aExact;
    });
  }

  return candidates.slice(0, 25);
}

/**
 * Links a payment layer transaction to a CRM Invoice (or Work Order's invoice) and settles it.
 */
export async function linkLayerTransactionToCrm(input: {
  accountId: string;
  providerPaymentId: string;
  providerOrderId?: string | null;
  invoiceId?: string | null;
  workOrderId?: string | null;
  actor: {
    actorType?: "user" | "system";
    actorUserId?: string | null;
    actorName?: string | null;
  };
  apiBase?: string;
}): Promise<{ invoiceId: string; invoiceNumber: string }> {
  const account = await PaymentProviderAccount.findById(input.accountId);
  if (!account) {
    throw new Error("Payment layer account not found");
  }

  let invoice: IInvoice | null = null;
  if (input.invoiceId && Types.ObjectId.isValid(input.invoiceId)) {
    invoice = await Invoice.findById(input.invoiceId);
  } else if (input.workOrderId && Types.ObjectId.isValid(input.workOrderId)) {
    invoice = await Invoice.findOne({
      workOrderRef: new Types.ObjectId(input.workOrderId),
      status: { $ne: "void" },
    }).sort({ createdAt: -1 });
    if (!invoice) {
      const wo = await WorkOrder.findById(input.workOrderId);
      if (!wo) {
        throw new Error("Target work order not found");
      }
      if (!wo.completed) {
        wo.completed = true;
        await wo.save();
      }
      const ensured = await ensureOpenInvoiceForWorkOrder(wo, {
        actor: input.actor,
      });
      invoice = ensured.invoice;
    }
  }

  if (!invoice) {
    throw new Error("Target CRM invoice or work order not found");
  }

  invoice.paymentProvider = account.provider;
  invoice.paymentProviderAccountRef = account._id as Types.ObjectId;
  invoice.providerPaymentId = input.providerPaymentId;
  if (input.providerOrderId) {
    invoice.providerOrderId = input.providerOrderId;
  }

  if (invoice.status === "paid") {
    await invoice.save();
  } else {
    await settleInvoicePayment({
      invoices: [invoice],
      providerPaymentId: input.providerPaymentId,
      providerOrderId: input.providerOrderId ?? null,
      actor: input.actor,
      method: "card",
      apiBase: input.apiBase,
    });
  }

  return {
    invoiceId: String(invoice._id),
    invoiceNumber: invoice.number,
  };
}

export { PAYMENT_PROVIDERS };
