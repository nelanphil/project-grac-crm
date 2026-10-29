import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDateForTemplate } from "./messageTemplate";
import {
  pickRenewalVariantBody,
  renewalTimingFields,
  renewalVariantStatus,
  sampleContextForRenewalStatus,
  type RenewalVariants,
} from "./renewalVariants";

const TODAY = new Date(Date.UTC(2026, 9, 29));

function dueIn(days: number): Date {
  return new Date(Date.UTC(2026, 9, 29 + days));
}

const variants: RenewalVariants = {
  enabled: true,
  dueSoonDays: 30,
  expired: "Expired copy",
  dueSoon: "Due soon copy",
  active: "Active copy",
};

describe("renewalVariantStatus", () => {
  it("treats a past due date as expired", () => {
    assert.equal(
      renewalVariantStatus({ renewalDueDate: dueIn(-1) }, 30, TODAY),
      "expired",
    );
  });

  it("treats today and the window boundary as due soon", () => {
    assert.equal(
      renewalVariantStatus({ renewalDueDate: dueIn(0) }, 30, TODAY),
      "due_soon",
    );
    assert.equal(
      renewalVariantStatus({ renewalDueDate: dueIn(30) }, 30, TODAY),
      "due_soon",
    );
  });

  it("treats a due date past the window as active", () => {
    assert.equal(
      renewalVariantStatus({ renewalDueDate: dueIn(31) }, 30, TODAY),
      "active",
    );
  });

  it("uses the template window rather than a fixed 30 days", () => {
    assert.equal(
      renewalVariantStatus({ renewalDueDate: dueIn(10) }, 7, TODAY),
      "active",
    );
    assert.equal(
      renewalVariantStatus({ renewalDueDate: dueIn(7) }, 7, TODAY),
      "due_soon",
    );
  });

  it("has no status when there is no renewal date", () => {
    assert.equal(
      renewalVariantStatus({ renewalDueDate: null }, 30, TODAY),
      "none",
    );
  });

  it("counts a contract already renewed into next year as active", () => {
    assert.equal(
      renewalVariantStatus(
        { renewalDueDate: dueIn(-20), renewalStatus: "renewed" },
        30,
        TODAY,
      ),
      "active",
    );
  });
});

describe("renewalTimingFields", () => {
  it("fills days until due and leaves days past due blank", () => {
    const fields = renewalTimingFields(
      {
        renewalDueDate: dueIn(14),
        lastRenewalDate: dueIn(-351),
        contractDate: dueIn(-400),
      },
      30,
      TODAY,
    );
    assert.equal(fields.renewal_status, "due soon");
    assert.equal(fields.days_until_due, "14");
    assert.equal(fields.days_past_due, "");
    assert.equal(fields.last_renewal_date, formatDateForTemplate(dueIn(-351)));
    assert.equal(fields.contract_start_date, formatDateForTemplate(dueIn(-400)));
  });

  it("fills days past due and leaves days until due blank", () => {
    const fields = renewalTimingFields(
      { renewalDueDate: dueIn(-5) },
      30,
      TODAY,
    );
    assert.equal(fields.renewal_status, "expired");
    assert.equal(fields.days_until_due, "");
    assert.equal(fields.days_past_due, "5");
  });

  it("leaves timing blank when there is no renewal date", () => {
    const fields = renewalTimingFields({ renewalDueDate: null }, 30, TODAY);
    assert.equal(fields.renewal_status, "");
    assert.equal(fields.days_until_due, "");
    assert.equal(fields.days_past_due, "");
  });
});

describe("pickRenewalVariantBody", () => {
  it("picks the box for each status", () => {
    assert.equal(pickRenewalVariantBody(variants, "expired", "Fallback"), "Expired copy");
    assert.equal(pickRenewalVariantBody(variants, "due_soon", "Fallback"), "Due soon copy");
    assert.equal(pickRenewalVariantBody(variants, "active", "Fallback"), "Active copy");
  });

  it("uses the fallback when the box is blank or the contact has no renewal", () => {
    const blank = { ...variants, expired: "   " };
    assert.equal(pickRenewalVariantBody(blank, "expired", "Fallback"), "Fallback");
    assert.equal(pickRenewalVariantBody(variants, "none", "Fallback"), "Fallback");
  });

  it("ignores the boxes when variants are turned off", () => {
    assert.equal(
      pickRenewalVariantBody({ ...variants, enabled: false }, "expired", "Fallback"),
      "Fallback",
    );
    assert.equal(pickRenewalVariantBody(null, "active", "Fallback"), "Fallback");
  });
});

describe("sampleContextForRenewalStatus", () => {
  it("sets sample dates that match the previewed status", () => {
    const expired = sampleContextForRenewalStatus({}, "expired", 30, TODAY);
    assert.equal(expired.renewal_status, "expired");
    assert.equal(expired.days_past_due, "30");
    assert.equal(expired.days_until_due, "");
    assert.equal(expired.renewal_due_date, formatDateForTemplate(dueIn(-30)));

    const dueSoon = sampleContextForRenewalStatus({}, "due_soon", 30, TODAY);
    assert.equal(dueSoon.renewal_status, "due soon");
    assert.equal(dueSoon.days_until_due, "14");
    assert.equal(dueSoon.days_past_due, "");

    const active = sampleContextForRenewalStatus({}, "active", 30, TODAY);
    assert.equal(active.renewal_status, "active");
    assert.equal(active.days_until_due, "90");
  });

  it("keeps a short due-soon window inside the template setting", () => {
    const dueSoon = sampleContextForRenewalStatus({}, "due_soon", 7, TODAY);
    assert.equal(dueSoon.days_until_due, "7");
  });
});
