import { z } from "zod";
import { ticketPartSchema } from "./serviceTicket.schema";

export const createEstimateTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  descPerform: z.string().max(8000).optional().default(""),
  laborHours: z.number().min(0).optional().default(0),
  parts: z.array(ticketPartSchema).optional().default([]),
});

export const updateEstimateTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  descPerform: z.string().max(8000).optional(),
  laborHours: z.number().min(0).optional(),
  parts: z.array(ticketPartSchema).optional(),
});

export const setEstimateTemplateDefaultSchema = z.object({
  isDefault: z.boolean().optional().default(true),
});

export type CreateEstimateTemplateInput = z.infer<
  typeof createEstimateTemplateSchema
>;
export type UpdateEstimateTemplateInput = z.infer<
  typeof updateEstimateTemplateSchema
>;
