import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createEstimateTemplateSchema } from "../schemas/estimateTemplate.schema";
import {
  partsForTemplate,
  productLineCount,
  toPublicEstimateTemplate,
} from "./estimateTemplate";

describe("estimate templates", () => {
  it("requires a template name", () => {
    const parsed = createEstimateTemplateSchema.safeParse({ name: "  " });
    assert.equal(parsed.success, false);
  });

  it("normalizes catalog parts and drops empty rows", () => {
    const parts = partsForTemplate([
      {
        productRef: "64b0f2c2a1b2c3d4e5f60789",
        lineType: "product",
        kind: "part",
        partNumber: "ASC",
        description: "Annual service",
        quantity: 1,
        unitPrice: 300,
        listPrice: 300,
        priceOverridden: false,
      },
      {
        lineType: "note",
        description: "Includes filters",
      },
      {
        lineType: "product",
        partNumber: "",
        description: "",
        quantity: 0,
      },
    ]);

    assert.equal(parts.length, 2);
    assert.equal(parts[0].partNumber, "ASC");
    assert.equal(parts[0].amount, 300);
    assert.equal(String(parts[0].productRef), "64b0f2c2a1b2c3d4e5f60789");
    assert.equal(parts[1].lineType, "note");
    assert.equal(productLineCount(parts), 1);
  });

  it("exposes public template fields for the create-estimate picker", () => {
    const publicTemplate = toPublicEstimateTemplate({
      _id: "tmpl-1",
      name: "ASC visit",
      descPerform: "Annual service",
      laborHours: 1.5,
      isDefault: true,
      createdBy: "64b0f2c2a1b2c3d4e5f60789",
      parts: [
        {
          productRef: "64b0f2c2a1b2c3d4e5f60780",
          lineType: "product",
          kind: "part",
          partNumber: "ASC",
          description: "Annual service",
          quantity: 1,
          unitPrice: 300,
          listPrice: 300,
          priceOverridden: false,
          amount: 300,
        },
      ],
    });

    assert.equal(publicTemplate.name, "ASC visit");
    assert.equal(publicTemplate.isDefault, true);
    assert.equal(publicTemplate.productCount, 1);
    assert.equal(publicTemplate.parts[0].productRef, "64b0f2c2a1b2c3d4e5f60780");
    assert.equal(publicTemplate.createdBy, "64b0f2c2a1b2c3d4e5f60789");
  });
});
