import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { activityHref } from "./activityLinks";

const customerId = "cust1";

describe("activityHref", () => {
  it("opens the record for work orders, estimates, invoices, and contracts", () => {
    assert.equal(
      activityHref(
        { action: "created", entityType: "work_order", entityId: "wo1" },
        customerId,
      ),
      "/dashboard/work-orders/detail?id=wo1",
    );
    assert.equal(
      activityHref(
        {
          action: "created",
          entityType: "work_order_note",
          entityId: "note1",
          metadata: { workOrderId: "wo9" },
        },
        customerId,
      ),
      "/dashboard/work-orders/detail?id=wo9",
    );
    assert.equal(
      activityHref(
        { action: "signed", entityType: "estimate", entityId: "est1" },
        customerId,
      ),
      "/dashboard/estimates/detail?id=est1",
    );
    assert.equal(
      activityHref(
        { action: "paid", entityType: "invoice", entityId: "inv1" },
        customerId,
      ),
      "/dashboard/orders/detail?id=inv1",
    );
    assert.equal(
      activityHref(
        { action: "renewed", entityType: "contract", entityId: "con1" },
        customerId,
      ),
      "/dashboard/contracts/edit?id=con1&returnTo=%2Fdashboard%2Fcustomers%2Fdetail%3Fid%3Dcust1",
    );
  });

  it("switches tabs on the same customer for notes, contacts, and addresses", () => {
    assert.equal(
      activityHref(
        { action: "created", entityType: "customer_note", entityId: "n1" },
        customerId,
      ),
      "/dashboard/customers/detail?id=cust1&tab=notes",
    );
    assert.equal(
      activityHref(
        { action: "updated", entityType: "contact", entityId: "c1" },
        customerId,
      ),
      "/dashboard/customers/detail?id=cust1&tab=contacts",
    );
    assert.equal(
      activityHref(
        { action: "updated", entityType: "equipment", entityId: "eq1" },
        customerId,
      ),
      "/dashboard/customers/detail?id=cust1&tab=address",
    );
  });

  it("opens a message thread when one was stored, otherwise the communications tab", () => {
    assert.equal(
      activityHref(
        {
          action: "received",
          entityType: "twilio_communication",
          entityId: "msg1",
          metadata: { threadId: "thread9" },
        },
        customerId,
      ),
      "/dashboard/inboxes",
    );
    assert.equal(
      activityHref(
        {
          action: "sent",
          entityType: "email_communication",
          entityId: "email1",
        },
        customerId,
      ),
      "/dashboard/customers/detail?id=cust1&tab=communications",
    );
  });

  it("does not link deleted rows, sign-ins, or account events", () => {
    assert.equal(
      activityHref(
        { action: "deleted", entityType: "work_order", entityId: "wo1" },
        customerId,
      ),
      null,
    );
    assert.equal(
      activityHref(
        { action: "logged_in", entityType: "user", entityId: "user1" },
        customerId,
      ),
      null,
    );
    assert.equal(
      activityHref(
        { action: "created", entityType: "customer", entityId: customerId },
        customerId,
      ),
      null,
    );
  });
});
