import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  automatedEmailPauseReason,
  readEmailDelivery,
} from "./automatedMessage.service";

describe("readEmailDelivery", () => {
  it("leaves every email on when nothing has been saved", () => {
    const delivery = readEmailDelivery(null, true);
    assert.equal(delivery.enabled, true);
    assert.equal(delivery.workOrderCompleteEmail, true);
    assert.equal(delivery.paymentReceivedEmail, true);
    assert.equal(delivery.paidInvoiceReceiptEmail, true);
    assert.equal(delivery.mailboxReply, true);
    assert.equal(delivery.renewalScheduleEmail, true);
    assert.equal(automatedEmailPauseReason(delivery, "paymentReceivedEmail"), null);
  });

  it("keeps a renewal email off when that older switch was already off", () => {
    const delivery = readEmailDelivery(null, false);
    assert.equal(delivery.renewalScheduleEmail, false);
    assert.equal(delivery.paymentReceivedEmail, true);
    assert.equal(
      automatedEmailPauseReason(delivery, "renewalScheduleEmail"),
      "This email is turned off in Automated messages.",
    );
  });

  it("pauses every email when the master switch is off", () => {
    const delivery = readEmailDelivery(
      {
        enabled: false,
        workOrderCompleteEmail: true,
        paymentReceivedEmail: true,
        paidInvoiceReceiptEmail: true,
        mailboxReply: true,
        renewalScheduleEmail: true,
      },
      true,
    );
    assert.equal(
      automatedEmailPauseReason(delivery, "mailboxReply"),
      "Automated emails are turned off.",
    );
    assert.equal(
      automatedEmailPauseReason(delivery, "workOrderCompleteEmail"),
      "Automated emails are turned off.",
    );
  });

  it("pauses one email without stopping the others", () => {
    const delivery = readEmailDelivery(
      {
        enabled: true,
        workOrderCompleteEmail: false,
        paymentReceivedEmail: true,
      },
      true,
    );
    assert.equal(
      automatedEmailPauseReason(delivery, "workOrderCompleteEmail"),
      "This email is turned off in Automated messages.",
    );
    assert.equal(automatedEmailPauseReason(delivery, "paymentReceivedEmail"), null);
    assert.equal(automatedEmailPauseReason(delivery, "paidInvoiceReceiptEmail"), null);
  });
});
