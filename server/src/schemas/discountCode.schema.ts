import { z } from "zod";
import {
  DISCOUNT_APPLIES_TO,
  DISCOUNT_MODES,
} from "../models/mongo/DiscountCode";

const optionalPositiveInt = z
  .union([z.number().int().min(1), z.null()])
  .optional();

const expiresAtSchema = z.union([z.string().min(1), z.null()]).optional();

export const createDiscountCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use letters, numbers, and hyphens"),
    label: z.string().trim().max(120).optional().default(""),
    mode: z.enum(DISCOUNT_MODES),
    value: z.number().int().min(1),
    active: z.boolean().optional().default(true),
    expiresAt: expiresAtSchema,
    maxRedemptions: optionalPositiveInt,
    maxRedemptionsPerCustomer: optionalPositiveInt,
    minSubtotalCents: optionalPositiveInt,
    appliesTo: z.array(z.enum(DISCOUNT_APPLIES_TO)).optional().default([]),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "percent" && data.value > 100) {
      ctx.addIssue({
        code: "custom",
        message: "Percent must be between 1 and 100",
        path: ["value"],
      });
    }
  });

export const updateDiscountCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(2)
      .max(40)
      .regex(/^[A-Z0-9][A-Z0-9-]*$/, "Use letters, numbers, and hyphens")
      .optional(),
    label: z.string().trim().max(120).optional(),
    mode: z.enum(DISCOUNT_MODES).optional(),
    value: z.number().int().min(1).optional(),
    active: z.boolean().optional(),
    expiresAt: expiresAtSchema,
    maxRedemptions: optionalPositiveInt,
    maxRedemptionsPerCustomer: optionalPositiveInt,
    minSubtotalCents: optionalPositiveInt,
    appliesTo: z.array(z.enum(DISCOUNT_APPLIES_TO)).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "percent" && data.value != null && data.value > 100) {
      ctx.addIssue({
        code: "custom",
        message: "Percent must be between 1 and 100",
        path: ["value"],
      });
    }
  });

export type CreateDiscountCodeInput = z.infer<typeof createDiscountCodeSchema>;
export type UpdateDiscountCodeInput = z.infer<typeof updateDiscountCodeSchema>;
