import { Schema } from "mongoose";
import {
  DEFAULT_KIND_DISCOUNT,
  DEFAULT_PRODUCT_DISCOUNTS,
} from "../../utils/productDiscounts";

export const kindDiscountSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    mode: {
      type: String,
      enum: ["percent", "amount"],
      default: "percent",
    },
    value: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

export const productDiscountsSchema = new Schema(
  {
    parts: { type: kindDiscountSchema, default: () => ({ ...DEFAULT_KIND_DISCOUNT }) },
    labor: { type: kindDiscountSchema, default: () => ({ ...DEFAULT_KIND_DISCOUNT }) },
  },
  { _id: false },
);

export const contractProductDiscountsSchema = new Schema(
  {
    override: { type: Boolean, default: false },
    parts: { type: kindDiscountSchema, default: () => ({ ...DEFAULT_KIND_DISCOUNT }) },
    labor: { type: kindDiscountSchema, default: () => ({ ...DEFAULT_KIND_DISCOUNT }) },
  },
  { _id: false },
);

export const ticketContractDiscountSchema = new Schema(
  {
    label: { type: String, default: "" },
    parts: { type: kindDiscountSchema, default: () => ({ ...DEFAULT_KIND_DISCOUNT }) },
    labor: { type: kindDiscountSchema, default: () => ({ ...DEFAULT_KIND_DISCOUNT }) },
  },
  { _id: false },
);

export { DEFAULT_KIND_DISCOUNT, DEFAULT_PRODUCT_DISCOUNTS };
