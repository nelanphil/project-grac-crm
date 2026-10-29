import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALREADY_COMPLETE_REASON,
  INVOICE_NOT_OPEN_REASON,
  NO_CONTACT_REASON,
  NO_CUSTOMER_REASON,
  ZERO_TOTAL_REASON,
  completionBlockedReason,
  sendBlockedReason,
  settleCompletedBlockedReason,
  validateCompletionSend,
  type CompletionContact,
} from "./workOrderCompletion.service";

const reachable: CompletionContact = {
  _id: "a".repeat(24),
  name: "Ada Owner",
  phone: "(813) 555-0100",
  email: "ada@example.com",
  phoneValid: true,
  emailValid: true,
  isPrimary: true,
};

const emailOnly: CompletionContact = {
  ...reachable,
  _id: "b".repeat(24),
  phone: "555",
  phoneValid: false,
  emailValid: true,
  isPrimary: false,
};

describe("completionBlockedReason", () => {
  const open = {
    completed: false,
    totalCents: 15000,
    hasCustomer: true,
  };

  it("blocks a work order that is already complete", () => {
    assert.equal(
      completionBlockedReason({ ...open, completed: true }),
      ALREADY_COMPLETE_REASON,
    );
  });

  it("blocks a zero or negative total before other gaps", () => {
    assert.equal(
      completionBlockedReason({ ...open, totalCents: 0, hasCustomer: false }),
      ZERO_TOTAL_REASON,
    );
    assert.equal(
      completionBlockedReason({ ...open, totalCents: -100 }),
      ZERO_TOTAL_REASON,
    );
  });

  it("allows a prepaid renewal visit to close at zero", () => {
    assert.equal(
      completionBlockedReason({ ...open, totalCents: 0, allowZeroTotal: true }),
      null,
    );
  });

  it("blocks a work order with no customer", () => {
    assert.equal(
      completionBlockedReason({ ...open, hasCustomer: false }),
      NO_CUSTOMER_REASON,
    );
  });

  it("allows a billable work order even when no contact can be reached", () => {
    assert.equal(completionBlockedReason(open), null);
  });
});

describe("sendBlockedReason", () => {
  it("blocks a customer with no reachable contact", () => {
    assert.equal(sendBlockedReason(0), NO_CONTACT_REASON);
  });

  it("allows a customer with a reachable contact", () => {
    assert.equal(sendBlockedReason(2), null);
  });
});

describe("validateCompletionSend", () => {
  it("rejects a contact that is missing or unreachable", () => {
    const missing = validateCompletionSend({
      contacts: [reachable],
      contactId: "c".repeat(24),
    });
    assert.equal(missing.ok, false);
    const unreachable = validateCompletionSend({
      contacts: [{ ...emailOnly, email: "", emailValid: false }],
      contactId: emailOnly._id,
    });
    assert.equal(unreachable.ok, false);
  });

  it("uses the stored phone and email when no override is sent", () => {
    const result = validateCompletionSend({
      contacts: [reachable],
      contactId: reachable._id,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.sms, { status: "send" });
    assert.deepEqual(result.plan.email, { status: "send" });
  });

  it("skips a cleared channel and keeps the other", () => {
    const result = validateCompletionSend({
      contacts: [reachable],
      contactId: reachable._id,
      phoneOverride: "",
      emailOverride: "ada@example.com",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.sms, { status: "skip" });
    assert.deepEqual(result.plan.email, { status: "send" });
  });

  it("rejects an override that is not a 10-digit phone or a valid email", () => {
    const phone = validateCompletionSend({
      contacts: [reachable],
      contactId: reachable._id,
      phoneOverride: "555-010",
    });
    assert.equal(phone.ok, false);
    if (!phone.ok) assert.match(phone.message, /10-digit/);

    const email = validateCompletionSend({
      contacts: [reachable],
      contactId: reachable._id,
      emailOverride: "not-an-email",
    });
    assert.equal(email.ok, false);
    if (!email.ok) assert.match(email.message, /email/);
  });

  it("sends an overridden phone and email", () => {
    const result = validateCompletionSend({
      contacts: [emailOnly],
      contactId: emailOnly._id,
      phoneOverride: "(813) 555-0199",
      emailOverride: "billing@example.com",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.plan.sms, {
      status: "send",
      toOverride: "(813) 555-0199",
    });
    assert.deepEqual(result.plan.email, {
      status: "send",
      toOverride: "billing@example.com",
    });
  });

  it("rejects a send with neither a phone nor an email", () => {
    const result = validateCompletionSend({
      contacts: [reachable],
      contactId: reachable._id,
      phoneOverride: " ",
      emailOverride: "",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /phone number or email/);
  });
});

describe("settleCompletedBlockedReason", () => {
  it("rejects an incomplete order for its blocked reason", () => {
    assert.deepEqual(
      settleCompletedBlockedReason({
        completed: false,
        mode: "pay_now",
        blockedReason: ZERO_TOTAL_REASON,
        invoiceOpen: false,
      }),
      { action: "reject", message: ZERO_TOTAL_REASON },
    );
  });

  it("starts a fresh completion when the order is open and unblocked", () => {
    assert.deepEqual(
      settleCompletedBlockedReason({
        completed: false,
        mode: "paid_offline",
        blockedReason: null,
        invoiceOpen: false,
      }),
      { action: "fresh" },
    );
  });

  it("reuses the open invoice when switching payment on a completed order", () => {
    for (const mode of ["pay_now", "paid_offline"] as const) {
      assert.deepEqual(
        settleCompletedBlockedReason({
          completed: true,
          mode,
          blockedReason: ALREADY_COMPLETE_REASON,
          invoiceOpen: true,
        }),
        { action: "reuse_open" },
      );
    }
  });

  it("keeps send on a completed order rejected", () => {
    assert.deepEqual(
      settleCompletedBlockedReason({
        completed: true,
        mode: "send",
        blockedReason: ALREADY_COMPLETE_REASON,
        invoiceOpen: true,
      }),
      { action: "reject", message: ALREADY_COMPLETE_REASON },
    );
  });

  it("rejects a completed order whose invoice is no longer open", () => {
    assert.deepEqual(
      settleCompletedBlockedReason({
        completed: true,
        mode: "pay_now",
        blockedReason: ALREADY_COMPLETE_REASON,
        invoiceOpen: false,
      }),
      { action: "reject", message: INVOICE_NOT_OPEN_REASON },
    );
  });

  it("rejects a completed order for a reason other than already complete", () => {
    assert.deepEqual(
      settleCompletedBlockedReason({
        completed: true,
        mode: "paid_offline",
        blockedReason: NO_CUSTOMER_REASON,
        invoiceOpen: true,
      }),
      { action: "reject", message: NO_CUSTOMER_REASON },
    );
  });

  it("reopens a check or cash payment when the invoice is no longer open", () => {
    for (const mode of ["pay_now", "paid_offline"] as const) {
      assert.deepEqual(
        settleCompletedBlockedReason({
          completed: true,
          mode,
          blockedReason: ALREADY_COMPLETE_REASON,
          invoiceOpen: false,
          offlinePaid: true,
        }),
        { action: "revert_offline" },
      );
    }
  });

  it("still rejects a paid invoice that was not recorded as check or cash", () => {
    assert.deepEqual(
      settleCompletedBlockedReason({
        completed: true,
        mode: "pay_now",
        blockedReason: ALREADY_COMPLETE_REASON,
        invoiceOpen: false,
        offlinePaid: false,
      }),
      { action: "reject", message: INVOICE_NOT_OPEN_REASON },
    );
  });
});
