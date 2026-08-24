import { z } from "zod";
import { ESTIMATE_STATUSES } from "../models/mongo/Estimate";
import {
  ticketContractSchema,
  ticketMoneySchema,
  ticketPartSchema,
  ticketSignatureSchema,
  ticketSnapshotSchema,
} from "./serviceTicket.schema";

const objectIdOrNull = z.union([z.string().trim(), z.null()]).optional();

export const createEstimateSchema = z
  .object({
    customerId: z.coerce.number().int().positive(),
    addressRef: objectIdOrNull,
    equipmentRef: objectIdOrNull,
    descPerform: z.string().optional(),
    date: z.union([z.string(), z.null()]).optional(),
    tech: z.string().optional(),
    status: z.enum(ESTIMATE_STATUSES).optional(),
    parts: z.array(ticketPartSchema).optional(),
  })
  .merge(ticketSnapshotSchema)
  .merge(ticketMoneySchema)
  .merge(ticketSignatureSchema)
  .merge(ticketContractSchema);

export const updateEstimateSchema = createEstimateSchema
  .partial()
  .omit({ customerId: true })
  .extend({
    customerId: z.coerce.number().int().positive().optional(),
    status: z.enum(ESTIMATE_STATUSES).optional(),
  });

export type CreateEstimateInput = z.infer<typeof createEstimateSchema>;
export type UpdateEstimateInput = z.infer<typeof updateEstimateSchema>;
