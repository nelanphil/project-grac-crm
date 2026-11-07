import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchLayerTransactionsAndComputePnL,
  type CrmInvoiceForMatch,
  type CrmWorkOrderForMatch,
} from "./paymentLayerReport.service";
import type { ProviderLayerTransaction } from "../payments/types";

describe("matchLayerTransactionsAndComputePnL", () => {
  const baseInvoice: CrmInvoiceForMatch = {
    _id: "65f000000000000000000001",
    number: "INV-2026-0010",
    status: "paid",
    amountCents: 15000,
    issuedAt: "2026-11-01T10:00:00.000Z",
    paidAt: "2026-11-01T12:00:00.000Z",
    paymentProvider: "square",
    paymentProviderAccountRef: "acc-1",
    providerPaymentId: "sq-pay-100",
    providerOrderId: "sq-ord-100",
    posTransactionId: null,
    customerRef: "cust-1",
    customerName: "Jane Doe",
    customerEmails: ["jane@example.com"],
    workOrderRef: "wo-1",
    workOrderNumber: "WO-2026-0010",
  };

  const openInvoice: CrmInvoiceForMatch = {
    _id: "65f000000000000000000002",
    number: "INV-2026-0011",
    status: "open",
    amountCents: 22500,
    issuedAt: "2026-11-02T09:00:00.000Z",
    paidAt: null,
    paymentProvider: null,
    paymentProviderAccountRef: null,
    providerPaymentId: null,
    providerOrderId: null,
    posTransactionId: null,
    customerRef: "cust-2",
    customerName: "Bob Smith",
    customerEmails: ["bob@example.com"],
    workOrderRef: "wo-2",
    workOrderNumber: "WO-2026-0011",
  };

  const unpaidWorkOrder: CrmWorkOrderForMatch = {
    _id: "wo-3",
    number: "WO-2026-0012",
    status: "completed",
    paid: false,
    amountCents: 9500,
    date: "2026-11-03T00:00:00.000Z",
    customerRef: "cust-3",
    customerName: "Alice Carter",
    customerEmails: ["alice@example.com"],
    invoiceId: null,
    invoiceNumber: null,
  };

  it("matches exact CRM invoices, flags candidate matches, and isolates unmatched off-app charges in P&L", () => {
    const transactions: ProviderLayerTransaction[] = [
      // 1. Exact match via providerPaymentId
      {
        provider: "square",
        providerPaymentId: "sq-pay-100",
        providerOrderId: "sq-ord-100",
        createdAt: "2026-11-01T12:00:00.000Z",
        status: "paid",
        providerStatus: "COMPLETED",
        grossCents: 15000,
        amountCents: 15000,
        tipCents: 0,
        taxCents: 0,
        feeCents: 465,
        refundedCents: 0,
        netCents: 14535,
        currency: "USD",
        payerName: "Jane Doe",
        payerEmail: "jane@example.com",
        note: "invoice:65f000000000000000000001",
        invoiceIds: ["65f000000000000000000001"],
        detail: {
          squareProduct: "SQUARE_POS",
          entryMethod: "CONTACTLESS",
          cardBrand: "VISA",
          last4: "4242",
        },
      },
      // 2. Possible match against openInvoice (same amount + close date + email)
      {
        provider: "square",
        providerPaymentId: "sq-pay-200",
        providerOrderId: "sq-ord-200",
        createdAt: "2026-11-02T14:00:00.000Z",
        status: "paid",
        providerStatus: "COMPLETED",
        grossCents: 22500,
        amountCents: 22500,
        tipCents: 0,
        taxCents: 0,
        feeCents: 682,
        refundedCents: 0,
        netCents: 21818,
        currency: "USD",
        payerName: "Bob Smith",
        payerEmail: "bob@example.com",
        note: "Custom charge in POS",
        invoiceIds: [],
      },
      // 3. Unmatched off-app charge (no matching CRM invoice or work order)
      {
        provider: "square",
        providerPaymentId: "sq-pay-300",
        providerOrderId: null,
        createdAt: "2026-11-04T16:30:00.000Z",
        status: "paid",
        providerStatus: "COMPLETED",
        grossCents: 5000,
        amountCents: 5000,
        tipCents: 0,
        taxCents: 0,
        feeCents: 175,
        refundedCents: 0,
        netCents: 4825,
        currency: "USD",
        payerName: "Walk-in Buyer",
        payerEmail: null,
        note: "Direct terminal sale",
        invoiceIds: [],
      },
      // 4. Failed charge (should not inflate P&L gross/net)
      {
        provider: "square",
        providerPaymentId: "sq-pay-400",
        providerOrderId: null,
        createdAt: "2026-11-04T17:00:00.000Z",
        status: "failed",
        providerStatus: "FAILED",
        grossCents: 8000,
        amountCents: 8000,
        tipCents: 0,
        taxCents: 0,
        feeCents: 0,
        refundedCents: 0,
        netCents: 0,
        currency: "USD",
        payerName: "Declined Card",
        payerEmail: null,
        note: null,
        invoiceIds: [],
      },
    ];

    const result = matchLayerTransactionsAndComputePnL({
      accountId: "acc-1",
      provider: "square",
      transactions,
      invoices: [baseInvoice, openInvoice],
      workOrders: [unpaidWorkOrder],
    });

    assert.equal(result.transactions.length, 4);

    // Row 1: Matched
    assert.equal(result.transactions[0]?.matchStatus, "matched");
    assert.equal(result.transactions[0]?.matchedRecord?.number, "INV-2026-0010");
    assert.equal(
      result.transactions[0]?.matchedRecord?.workOrderNumber,
      "WO-2026-0010",
    );

    // Row 2: Possible match
    assert.equal(result.transactions[1]?.matchStatus, "possible_match");
    assert.equal(result.transactions[1]?.candidates.length, 1);
    assert.equal(result.transactions[1]?.candidates[0]?.number, "INV-2026-0011");

    // Row 3: Unmatched (off-app)
    assert.equal(result.transactions[2]?.matchStatus, "unmatched");
    assert.equal(result.transactions[2]?.candidates.length, 0);

    // P&L totals (only paid/refunded count toward revenue)
    assert.equal(result.pnl.totalCount, 4);
    assert.equal(result.pnl.paidCount, 3);
    assert.equal(result.pnl.failedCount, 1);
    assert.equal(result.pnl.grossCents, 15000 + 22500 + 5000);
    assert.equal(result.pnl.feeCents, 465 + 682 + 175);
    assert.equal(result.pnl.netCents, 14535 + 21818 + 4825);
    assert.equal(result.pnl.matchedCount, 1);
    assert.equal(result.pnl.matchedCents, 15000);
    assert.equal(result.pnl.possibleMatchCount, 1);
    assert.equal(result.pnl.possibleMatchCents, 22500);
    assert.equal(result.pnl.unmatchedCount, 1);
    assert.equal(result.pnl.unmatchedCents, 5000);
  });
});

