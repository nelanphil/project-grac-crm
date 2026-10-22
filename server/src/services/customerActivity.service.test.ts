import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Types } from "mongoose";
import {
  activityCursorClause,
  activityListFilter,
  actorKindFromUser,
  categoryForEntityType,
  changesFromMetadata,
  diffFields,
  metadataWithoutChanges,
} from "./customerActivity.service";

describe("categoryForEntityType", () => {
  it("maps known records onto history categories", () => {
    assert.equal(categoryForEntityType("customer"), "account");
    assert.equal(categoryForEntityType("contact"), "contact");
    assert.equal(categoryForEntityType("invoice"), "invoice");
    assert.equal(categoryForEntityType("customer_note"), "note");
    assert.equal(categoryForEntityType("work_order_note"), "note");
    assert.equal(categoryForEntityType("mailbox_message"), "communication");
  });

  it("keeps unknown customer-linked events on the account category", () => {
    assert.equal(categoryForEntityType("role"), "account");
  });
});

describe("actorKindFromUser", () => {
  it("treats a customer login as the customer and everyone else as staff", () => {
    assert.equal(actorKindFromUser(null), "system");
    assert.equal(actorKindFromUser({ userType: "customer" }), "customer");
    assert.equal(actorKindFromUser({ role: "customer" }), "customer");
    assert.equal(actorKindFromUser({ userType: "staff", role: "admin" }), "staff");
    assert.equal(actorKindFromUser({ role: "tech" }), "staff");
  });
});

describe("diffFields", () => {
  it("returns only fields whose values changed", () => {
    const changes = diffFields(
      { phone: "555", email: "a@b.com", city: "Orlando" },
      { phone: "444", email: "a@b.com", city: "" },
      ["phone", "email", "city"],
    );
    assert.deepEqual(changes, [
      { field: "phone", from: "555", to: "444" },
      { field: "city", from: "Orlando", to: "" },
    ]);
  });

  it("treats null and an empty string as the same blank value", () => {
    assert.deepEqual(
      diffFields({ note: null }, { note: "" }, ["note"]),
      [],
    );
  });
});

describe("changesFromMetadata", () => {
  it("keeps well-formed changes and drops them from stored metadata", () => {
    const metadata = {
      customerName: "Nelan",
      activitySource: "portal",
      changes: [
        { field: "phone", from: "1", to: "2" },
        { field: "" },
        "nope",
      ],
    };
    assert.deepEqual(changesFromMetadata(metadata), [
      { field: "phone", from: "1", to: "2" },
    ]);
    assert.deepEqual(metadataWithoutChanges(metadata), { customerName: "Nelan" });
  });
});

describe("activity cursor", () => {
  const customerId = new Types.ObjectId();
  const cursor = {
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    id: new Types.ObjectId().toString(),
  };

  it("pages older rows strictly before the cursor", () => {
    const filter = activityListFilter({
      customerId,
      categories: ["payment"],
      actorKind: "customer",
      cursor,
      direction: "before",
    });
    assert.deepEqual(filter, {
      $and: [
        { customerRef: customerId },
        { category: { $in: ["payment"] } },
        { actorKind: "customer" },
        activityCursorClause(cursor, "before"),
      ],
    });
  });

  it("lists every customer when no customer is given", () => {
    const filter = activityListFilter({
      categories: ["note"],
      actorKind: "staff",
    });
    assert.deepEqual(filter, {
      $and: [{ category: { $in: ["note"] } }, { actorKind: "staff" }],
    });
    assert.deepEqual(activityListFilter({}), {});
  });

  it("stops the dashboard feed at the present", () => {
    const until = new Date("2026-10-22T18:00:00.000Z");
    assert.deepEqual(activityListFilter({ until }), {
      createdAt: { $lte: until },
    });
  });

  it("pages newer rows after the cursor for a reconnect gap", () => {
    const clause = activityCursorClause(cursor, "after");
    const ors = clause.$or as Array<Record<string, unknown>>;
    assert.equal(ors.length, 2);
    assert.deepEqual(ors[0], { createdAt: { $gt: cursor.createdAt } });
  });
});
