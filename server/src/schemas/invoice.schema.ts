import { z } from "zod";
import { INVOICE_SOURCE_TYPES } from "../models/mongo/Invoice";

export const createInvoiceSchema = z.object({
  sourceType: z.enum(INVOICE_SOURCE_TYPES),
  contractRef: z.string().trim().optional(),
  workOrderRef: z.string().trim().optional(),
  amountCents: z.number().int().positive().optional(),
  description: z.string().trim().max(500).optional(),
  dueDate: z.string().trim().optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
