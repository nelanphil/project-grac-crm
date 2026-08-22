import { z } from "zod";

export const createProductSchema = z.object({
  partNumber: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  unitPrice: z.number().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
  notes: z.string().max(2000).optional().default(""),
});

export const updateProductSchema = z.object({
  partNumber: z.string().trim().min(1).max(80).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  unitPrice: z.number().min(0).optional(),
  active: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
