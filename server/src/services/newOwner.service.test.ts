import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastContactBlock } from "../utils/customerContacts";
import { findAccountNameMatches } from "../utils/customerDuplicates";
import { isVacantReportCustomer } from "../utils/vacantCustomer";
import { newOwnerSchema } from "../schemas/customerSite.schema";
import {
  NEW_OWNER_DETACH_UPDATE,
  newOwnerNoteContent,
  planNewOwner,
  type NewOwnerContactSnapshot,
} from "./newOwner.service";

const house = "house";

function person(
  overrides: Partial<NewOwnerContactSnapshot> & Pick<NewOwnerContactSnapshot, "id">,
): NewOwnerContactSnapshot {
  return {
    customerId: house,
    first: "Jane",
    last: "Smith",
    phone: "5551234567",
    email: "jane@example.com",
    ...overrides,
  };
}

describe("planNewOwner", () => {
  it("detaches every contact, keeps them, and names the property Vacant", () => {
    const plan = planNewOwner({
      customerId: house,
      contactsOnCustomer: [
        person({ id: "c1", first: "Jane", last: "Smith" }),
        person({ id: "c2", first: "Bob", last: "Smith", phone: "", email: "" }),
      ],
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.detachIds, ["c1", "c2"]);
    assert.equal(plan.keeperId, null);
    assert.equal(plan.create, null);
    assert.equal(plan.accountName, "Vacant");
    assert.deepEqual(plan.identity, { first: "", last: "", phone: "", email: "" });
    assert.equal(plan.ensureLogin, false);
    assert.equal(
      plan.summary,
      "New owner: property is Vacant. Removed Jane Smith, Bob Smith.",
    );
    assert.equal("deletedAt" in NEW_OWNER_DETACH_UPDATE, false);
    assert.deepEqual(NEW_OWNER_DETACH_UPDATE, {
      customerRef: null,
      isPrimary: false,
    });
  });

  it("names the customer after the new contact and follows their phone and email", () => {
    const plan = planNewOwner({
      customerId: house,
      contactsOnCustomer: [person({ id: "c1" })],
      create: {
        first: "Alex",
        last: "Golovkov",
        phone: "3865550100",
        email: "alex@example.com",
      },
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.detachIds, ["c1"]);
    assert.equal(plan.accountName, "Alex Golovkov");
    assert.deepEqual(plan.identity, {
      first: "Alex",
      last: "Golovkov",
      phone: "3865550100",
      email: "alex@example.com",
    });
    assert.equal(plan.ensureLogin, true);
    assert.equal(plan.keeperId, null);
    assert.equal(plan.create?.first, "Alex");
  });

  it("keeps a chosen directory contact and detaches everyone else on the property", () => {
    const plan = planNewOwner({
      customerId: house,
      contactsOnCustomer: [
        person({ id: "c1" }),
        person({ id: "c2", first: "Bob", last: "Smith" }),
      ],
      selected: person({
        id: "c9",
        customerId: null,
        first: "Alex",
        last: "Golovkov",
        phone: "1112223333",
        email: "alex@example.com",
      }),
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.keeperId, "c9");
    assert.deepEqual(plan.detachIds, ["c1", "c2"]);
    assert.equal(plan.accountName, "Alex Golovkov");
    assert.equal(plan.identity.email, "alex@example.com");
    assert.equal(plan.ensureLogin, true);
  });

  it("refuses to pull the last contact off a different customer", () => {
    const plan = planNewOwner({
      customerId: house,
      contactsOnCustomer: [person({ id: "c1" })],
      selected: person({
        id: "c9",
        customerId: "other-house",
        first: "Alex",
        last: "Golovkov",
      }),
      otherCustomerActiveCount: 1,
    });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.equal(plan.status, 409);
    assert.match(plan.message, /keep at least one contact/);
  });

  it("still blocks an ordinary detach of the only contact", () => {
    assert.match(
      lastContactBlock(1, "detach") ?? "",
      /keep at least one contact/,
    );
    const plan = planNewOwner({
      customerId: house,
      contactsOnCustomer: [person({ id: "only" })],
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.deepEqual(plan.detachIds, ["only"]);
    assert.equal(plan.accountName, "Vacant");
  });

  it("rejects a missing reason and records who left with that reason", () => {
    const missing = newOwnerSchema.safeParse({});
    assert.equal(missing.success, false);
    if (!missing.success) {
      assert.equal(missing.error.issues[0]?.message, "A reason is required.");
    }

    const blank = newOwnerSchema.safeParse({ reason: "   " });
    assert.equal(blank.success, false);
    if (!blank.success) {
      assert.equal(blank.error.issues[0]?.message, "A reason is required.");
    }

    const plan = planNewOwner({
      customerId: house,
      contactsOnCustomer: [
        person({ id: "c1", first: "Claire", last: "Keijer" }),
      ],
      reason: "  Sold the house  ",
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    const note = newOwnerNoteContent({
      accountName: plan.accountName,
      removedNames: plan.removedNames,
      reason: "  Sold the house  ",
    });
    assert.match(note, /Claire Keijer/);
    assert.match(note, /Property is Vacant\./);
    assert.match(note, /Reason: Sold the house/);
    assert.match(plan.summary, /Claire Keijer/);
    assert.match(plan.summary, /Reason: Sold the house/);
    assert.deepEqual(plan.detachIds, ["c1"]);

    const named = planNewOwner({
      customerId: house,
      contactsOnCustomer: [
        person({ id: "c1", first: "Claire", last: "Keijer" }),
      ],
      create: {
        first: "taylor",
        last: "smith",
        phone: "",
        email: "",
      },
      reason: "Bought the house",
    });
    assert.equal(named.ok, true);
    if (!named.ok) return;
    const namedNote = newOwnerNoteContent({
      accountName: named.accountName,
      removedNames: named.removedNames,
      reason: "Bought the house",
    });
    assert.match(namedNote, /New owner: Taylor Smith\./);
    assert.match(namedNote, /Removed Claire Keijer\./);
    assert.match(namedNote, /Reason: Bought the house/);
    assert.deepEqual(named.detachIds, ["c1"]);
  });
});

describe("vacant customers", () => {
  it("lists only active unmerged customers with no contact", () => {
    assert.equal(
      isVacantReportCustomer({
        deletedAt: null,
        mergedIntoRef: null,
        activeContactCount: 0,
      }),
      true,
    );
    assert.equal(
      isVacantReportCustomer({
        deletedAt: null,
        mergedIntoRef: null,
        activeContactCount: 2,
      }),
      false,
    );
    assert.equal(
      isVacantReportCustomer({
        deletedAt: new Date(),
        mergedIntoRef: null,
        activeContactCount: 0,
      }),
      false,
    );
    assert.equal(
      isVacantReportCustomer({
        deletedAt: null,
        mergedIntoRef: "survivor",
        activeContactCount: 0,
      }),
      false,
    );
  });

  it("allows many customers to share the name Vacant", async () => {
    assert.deepEqual(await findAccountNameMatches("Vacant"), []);
    assert.deepEqual(await findAccountNameMatches(" vacant "), []);
  });
});
