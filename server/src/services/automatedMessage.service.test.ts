import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { AutomatedMessageSettings } from "../models/mongo/AutomatedMessageSettings";
import type { IInvoice, InvoiceStatus } from "../models/mongo/Invoice";
import { formatInvoiceDueDate } from "../utils/automatedMessageCopy";
import { customerInvoiceMessageDraft } from "./automatedMessage.service";

const WORK_ORDER_SMS =
  "Hi {{first_name}}, invoice {{invoice_number}} is ready. Total due: {{invoice_total}}. Due {{due_date}}.";
const RECEIPT_SMS =
  "Thanks {{first_name}}. Receipt {{invoice_number}} for {{invoice_total}}.";

function channel(body: string, subject = "") {
  return { mode: "custom" as const, templateRef: null, subject, body };
}

function savedSettings() {
  return {
    configured: true,
    workOrderCompleteSms: channel(WORK_ORDER_SMS),
    workOrderCompleteEmail: channel(
      "<p>Hi {{first_name}},</p><p>Invoice {{invoice_number}}</p>",
      "Bill {{invoice_number}}",
    ),
    paidInvoiceReceiptSms: channel(RECEIPT_SMS),
    paidInvoiceReceiptEmail: channel("", "Paid {{invoice_number}}"),
  };
}

function invoice(status: InvoiceStatus): IInvoice {
  return {
    status,
    number: "GMOF10262652584",
    amountCents: 52965,
    dueDate: new Date("2026-12-01T12:00:00.000Z"),
  } as IInvoice;
}

function tokensFilled(body: string): void {
  assert.equal(body.includes("{{first_name}}"), true);
  assert.equal(body.includes("{{invoice_number}}"), false);
  assert.equal(body.includes("{{invoice_total}}"), false);
  assert.equal(body.includes("GMOF10262652584"), true);
  assert.equal(body.includes("$529.65"), true);
}

describe("customerInvoiceMessageDraft", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("returns the saved work-order text for an open invoice with invoice tokens filled", async () => {
    mock.method(AutomatedMessageSettings, "findOne", () => ({
      lean: async () => savedSettings(),
    }));
    const source = invoice("open");
    const draft = await customerInvoiceMessageDraft(source);

    tokensFilled(draft.sms.body);
    assert.equal(draft.sms.body.includes("{{due_date}}"), false);
    assert.equal(draft.sms.body.includes("ready"), true);
    assert.equal(
      draft.sms.body.includes(formatInvoiceDueDate(source.dueDate)),
      true,
    );
    assert.equal(draft.email.subject, "Bill GMOF10262652584");
    assert.equal(draft.email.body.includes("{{first_name}}"), true);
    assert.equal(draft.email.body.includes("{{invoice_number}}"), false);
    assert.equal(draft.email.emailChrome, null);
  });

  it("returns the paid receipt text for a paid invoice", async () => {
    mock.method(AutomatedMessageSettings, "findOne", () => ({
      lean: async () => savedSettings(),
    }));
    const draft = await customerInvoiceMessageDraft(invoice("paid"));

    tokensFilled(draft.sms.body);
    assert.equal(draft.sms.body.startsWith("Thanks {{first_name}}"), true);
    assert.equal(draft.sms.body.includes("ready"), false);
    assert.equal(draft.email.subject, "Paid GMOF10262652584");
    assert.equal(draft.email.body.includes("{{invoice}}"), true);
    assert.equal(draft.email.body.includes("{{first_name}}"), true);
    assert.equal(draft.email.body.includes("GMOF10262652584"), true);
    assert.equal(draft.email.emailChrome, null);
  });

  it("keeps draft, void, and failed invoices on the work-order message", async () => {
    mock.method(AutomatedMessageSettings, "findOne", () => ({
      lean: async () => savedSettings(),
    }));
    for (const status of ["draft", "void", "failed"] as const) {
      const draft = await customerInvoiceMessageDraft(invoice(status));
      assert.equal(draft.sms.body.includes("ready"), true);
      assert.equal(draft.email.subject, "Bill GMOF10262652584");
    }
  });
});
