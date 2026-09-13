import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractQuotedServicePrice,
  hasPricedProductLines,
  legacyWorkOrderHasBillableMoney,
  mapLegacyWorkOrderItems,
} from "./legacyWorkOrderItems";

const CATALOG = [
  {
    _id: "64b0000000000000000000aa",
    productCode: "ASC",
    partNumber: "ASC",
    name: "ANNUAL SERVICE",
    kind: "labor" as const,
    listPrice: 300,
    unitPrice: 300,
  },
  {
    _id: "64b0000000000000000000bb",
    productCode: "BAT26R",
    partNumber: "BAT26R",
    name: "BATTERY 26R",
    kind: "part" as const,
    listPrice: 195,
    unitPrice: 195,
  },
  {
    _id: "64b0000000000000000000cc",
    productCode: "GEN22KW",
    partNumber: "GEN22KW",
    name: "22KW GENERATOR",
    kind: "part" as const,
    listPrice: 17000,
    unitPrice: 17000,
  },
];

describe("extractQuotedServicePrice", () => {
  it("reads ASC $300 PLUS PARTS", () => {
    assert.equal(extractQuotedServicePrice("ASC $300 PLUS PARTS"), 300);
  });

  it("ignores time windows and payment notes", () => {
    assert.equal(extractQuotedServicePrice("ASC 8-10"), 0);
    assert.equal(extractQuotedServicePrice("Paid check $395"), 0);
  });
});

describe("mapLegacyWorkOrderItems", () => {
  it("returns empty lines when the SQL ticket has no money", () => {
    const mapped = mapLegacyWorkOrderItems({
      descPerform: "ASC SOON",
      total: 0,
    });
    assert.deepEqual(mapped.parts, []);
    assert.equal(mapped.total, 0);
  });

  it("uses the first readable line when dump text has escaped newlines", () => {
    const mapped = mapLegacyWorkOrderItems({
      descPerform: "Tune up and inspect\\r\\nCall only",
      total: 250,
    });
    const labor = mapped.parts.find((part) => part.kind === "labor");
    assert.equal(labor?.description, "Tune up and inspect");
    assert.equal(mapped.total, 250);
  });

  it("maps a total-only ASC ticket to a labor line", () => {
    const mapped = mapLegacyWorkOrderItems({
      descPerform: "ASC\nSent link 4/20/26",
      descPerformed: "Oil filter change. Oil fill. Ran test.",
      total: 320,
    });
    assert.equal(mapped.total, 320);
    assert.equal(mapped.totalLabor, 320);
    assert.equal(mapped.totalParts, 0);
    const labor = mapped.parts.filter(
      (part) => part.lineType !== "note" && part.kind === "labor",
    );
    assert.equal(labor.length, 1);
    assert.equal(labor[0]?.amount, 320);
    assert.match(labor[0]?.partNumber ?? "", /ASC|IMPORTED/);
  });

  it("splits ASC $300 PLUS PARTS when the ticket total is higher", () => {
    const mapped = mapLegacyWorkOrderItems({
      descPerform: "ASC $300 PLUS PARTS",
      descPerformed: "Change oil, oil filter",
      total: 320,
    });
    assert.equal(mapped.total, 320);
    assert.equal(mapped.totalLabor, 300);
    assert.equal(mapped.totalParts, 20);
    const labor = mapped.parts.find((part) => part.kind === "labor");
    const parts = mapped.parts.filter(
      (part) => part.lineType !== "note" && part.kind === "part",
    );
    assert.equal(labor?.amount, 300);
    assert.equal(parts.reduce((sum, part) => sum + part.amount, 0), 20);
  });

  it("keeps an explicit parts/labor split from SQL columns", () => {
    const mapped = mapLegacyWorkOrderItems({
      descPerform: "test",
      descPerformed: "Replace carb",
      totalParts: 50,
      totalLabor: 50,
      subtotal: 0,
      total: 100,
    });
    assert.equal(mapped.total, 100);
    assert.equal(mapped.totalParts, 50);
    assert.equal(mapped.totalLabor, 50);
    assert.equal(
      mapped.parts.some((part) => part.kind === "part" && part.amount === 50),
      true,
    );
    assert.equal(
      mapped.parts.some((part) => part.kind === "labor" && part.amount === 50),
      true,
    );
  });

  it("links catalog products and uses their prices when they fit", () => {
    const mapped = mapLegacyWorkOrderItems(
      {
        descPerform: "ASC / New customer - RED light",
        descPerformed: "Replaced BAT26R battery. Annual service complete.",
        total: 495,
      },
      CATALOG,
    );
    assert.equal(mapped.total, 495);
    assert.equal(mapped.totalParts, 195);
    assert.equal(mapped.totalLabor, 300);
    const battery = mapped.parts.find((part) => part.partNumber === "BAT26R");
    const labor = mapped.parts.find((part) => part.kind === "labor");
    assert.equal(battery?.productRef, "64b0000000000000000000bb");
    assert.equal(battery?.amount, 195);
    assert.equal(labor?.productRef, "64b0000000000000000000aa");
    assert.equal(labor?.amount, 300);
  });

  it("does not attach an expensive catalog unit to a cheap service ticket", () => {
    const mapped = mapLegacyWorkOrderItems(
      {
        descPerform: "ASC 22kw check",
        total: 330,
      },
      CATALOG,
    );
    assert.equal(mapped.total, 330);
    assert.equal(
      mapped.parts.some((part) => part.partNumber === "GEN22KW"),
      false,
    );
  });

  it("preserves misc and shipping on top of mapped lines", () => {
    const mapped = mapLegacyWorkOrderItems({
      descPerform: "Service call",
      totalLabor: 250,
      miscExp: 15,
      shipping: 10,
      total: 275,
    });
    assert.equal(mapped.totalParts, 0);
    assert.equal(mapped.totalLabor, 250);
    assert.equal(mapped.miscExp, 15);
    assert.equal(mapped.shipping, 10);
    assert.equal(mapped.total, 275);
  });

  it("does not assign a whole service total to an addon keyword", () => {
    const mapped = mapLegacyWorkOrderItems({
      descPerform: "Not charging",
      descPerformed: "Battery was dead. Installed new one.",
      total: 320,
    });
    assert.equal(mapped.total, 320);
    const pricedParts = mapped.parts.filter(
      (part) => part.lineType !== "note" && part.kind === "part",
    );
    assert.equal(
      pricedParts.reduce((sum, part) => sum + part.amount, 0),
      0,
    );
    assert.equal(mapped.totalLabor, 320);
  });
});

describe("legacy mapping helpers", () => {
  it("detects billable money and priced lines", () => {
    assert.equal(legacyWorkOrderHasBillableMoney({ total: 10 }), true);
    assert.equal(legacyWorkOrderHasBillableMoney({ total: 0 }), false);
    assert.equal(hasPricedProductLines([]), false);
    assert.equal(
      hasPricedProductLines([{ lineType: "note" }, { lineType: "product" }]),
      true,
    );
  });
});
