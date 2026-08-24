import { z } from "zod";

export const kindDiscountSchema = z.object({
  enabled: z.boolean().optional().default(false),
  mode: z.enum(["percent", "amount"]).optional().default("percent"),
  value: z.number().min(0).optional().default(0),
});

export const productDiscountsSchema = z.object({
  parts: kindDiscountSchema.optional(),
  labor: kindDiscountSchema.optional(),
});

export const contractProductDiscountsSchema = productDiscountsSchema.extend({
  override: z.boolean().optional().default(false),
});

export const ticketContractDiscountSchema = productDiscountsSchema.extend({
  label: z.string().trim().max(120).optional().default(""),
});

export const createContractTemplateSchema = z.object({
  label: z.string().trim().min(1).max(120),
  body: z.string().max(50000).optional().default(""),
  cost: z.number().min(0).optional().default(0),
  badgeIcon: z.string().trim().min(1).max(80).optional().default("scroll-text"),
  productDiscounts: productDiscountsSchema.optional(),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase letters, numbers, and hyphens")
    .max(80)
    .optional(),
});

export const updateContractTemplateSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  body: z.string().max(50000).optional(),
  cost: z.number().min(0).optional(),
  badgeIcon: z.string().trim().min(1).max(80).optional(),
  productDiscounts: productDiscountsSchema.optional(),
});
