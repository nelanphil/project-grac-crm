import { z } from "zod";
import { PRODUCT_KINDS } from "../models/mongo/Product";

const manufacturerIdSchema = z
  .string()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid manufacturer id");

export const createProductSchema = z
  .object({
    productCode: z.string().trim().toUpperCase().min(1).max(80).optional(),
    partNumber: z.string().trim().toUpperCase().min(1).max(80).optional(),
    productNumber: z.string().trim().toUpperCase().max(80).optional().default(""),
    name: z.string().trim().toUpperCase().min(1).max(200),
    manufacturer: manufacturerIdSchema.optional(),
    kind: z.enum(PRODUCT_KINDS).optional().default("part"),
    listPrice: z.number().min(0).optional(),
    unitPrice: z.number().min(0).optional(),
    cost: z.number().min(0).optional().default(0),
    strikeThroughPrice: z.number().min(0).optional().default(0),
    active: z.boolean().optional().default(true),
    notes: z.string().trim().toUpperCase().max(2000).optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (!(data.productCode?.trim() || data.partNumber?.trim())) {
      ctx.addIssue({
        code: "custom",
        message: "Product code is required",
        path: ["productCode"],
      });
    }
  });

export const updateProductSchema = z.object({
  productCode: z.string().trim().toUpperCase().min(1).max(80).optional(),
  partNumber: z.string().trim().toUpperCase().min(1).max(80).optional(),
  productNumber: z.string().trim().toUpperCase().max(80).optional(),
  name: z.string().trim().toUpperCase().min(1).max(200).optional(),
  manufacturer: manufacturerIdSchema.optional(),
  kind: z.enum(PRODUCT_KINDS).optional(),
  listPrice: z.number().min(0).optional(),
  unitPrice: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  strikeThroughPrice: z.number().min(0).optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().toUpperCase().max(2000).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
