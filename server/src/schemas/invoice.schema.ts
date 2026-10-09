import { z } from "zod";
import { INVOICE_SOURCE_TYPES } from "../models/mongo/Invoice";

export const createInvoiceSchema = z.object({
  sourceType: z.enum(INVOICE_SOURCE_TYPES),
  contractRef: z.string().trim().optional(),
  workOrderRef: z.string().trim().optional(),
  amountCents: z.number().int().positive().optional(),
  description: z.string().trim().max(500).optional(),
  dueDate: z.string().trim().optional(),
  allowPaidBypass: z.boolean().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export const updateInvoiceTaxSchema = z
  .object({
    taxCents: z.number().int().min(0).optional(),
    taxRatePercent: z.number().min(0).max(100).optional(),
  })
  .refine(
    (value) => value.taxCents != null || value.taxRatePercent != null,
    { message: "taxCents or taxRatePercent is required" },
  );

export type UpdateInvoiceTaxInput = z.infer<typeof updateInvoiceTaxSchema>;

export const BULK_INVOICE_STATUS_LIMIT = 500;

export const bulkInvoiceStatusSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(BULK_INVOICE_STATUS_LIMIT),
  paid: z.boolean(),
});

export type BulkInvoiceStatusInput = z.infer<typeof bulkInvoiceStatusSchema>;
