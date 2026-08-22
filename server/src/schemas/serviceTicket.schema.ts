import { z } from "zod";

export const ticketPartSchema = z.object({
  productRef: z.string().trim().nullable().optional(),
  partNumber: z.string().trim().max(80).optional().default(""),
  description: z.string().trim().max(300).optional().default(""),
  quantity: z.number().min(0).optional().default(0),
  unitPrice: z.number().min(0).optional().default(0),
  amount: z.number().min(0).optional(),
});

export const ticketSnapshotSchema = z.object({
  customerName: z.string().trim().max(200).optional(),
  customerAddress: z.string().trim().max(300).optional(),
  customerCity: z.string().trim().max(120).optional(),
  customerZip: z.string().trim().max(20).optional(),
  customerPhone: z.string().trim().max(40).optional(),
  customerEmail: z.string().trim().max(200).optional(),
  workPhone: z.string().trim().max(40).optional(),
  serialNumber: z.string().trim().max(80).optional(),
  generatorModel: z.string().trim().max(120).optional(),
  exerciseDay: z.string().trim().max(40).optional(),
  exerciseTime: z.string().trim().max(40).optional(),
});

export const ticketMoneySchema = z.object({
  laborHours: z.number().min(0).optional(),
  runHours: z.number().min(0).optional(),
  totalLabor: z.number().min(0).optional(),
  laborOverridden: z.boolean().optional(),
  miscExp: z.number().min(0).optional(),
  shipping: z.number().min(0).optional(),
  subtotal: z.number().min(0).optional(),
  total: z.number().min(0).optional(),
});

export const ticketSignatureSchema = z.object({
  signatureDataUrl: z.string().max(400000).optional().nullable(),
  signedByName: z.string().trim().max(120).optional(),
});

export type TicketPartInput = z.infer<typeof ticketPartSchema>;
