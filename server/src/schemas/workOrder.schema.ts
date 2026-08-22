import { z } from "zod";
import {
  ticketMoneySchema,
  ticketPartSchema,
  ticketSignatureSchema,
  ticketSnapshotSchema,
} from "./serviceTicket.schema";

const objectIdOrNull = z.union([z.string().trim(), z.null()]).optional();

export const createWorkOrderSchema = z
  .object({
    customerId: z.coerce.number().int().positive(),
    addressRef: objectIdOrNull,
    equipmentRef: objectIdOrNull,
    estimateRef: objectIdOrNull,
    descPerform: z.string().optional(),
    descPerformed: z.string().optional(),
    date: z.union([z.string(), z.null()]).optional(),
    tech: z.string().optional(),
    assignedUserRef: objectIdOrNull,
    scheduledStart: z.union([z.string(), z.null()]).optional(),
    estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
    paid: z.boolean().optional(),
    completed: z.boolean().optional(),
    certify: z.boolean().optional(),
    parts: z.array(ticketPartSchema).optional(),
  })
  .merge(ticketSnapshotSchema)
  .merge(ticketMoneySchema)
  .merge(ticketSignatureSchema);

export const updateWorkOrderSchema = z
  .object({
    assignedUserRef: objectIdOrNull,
    scheduledStart: z.union([z.string(), z.null()]).optional(),
    estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
    descPerform: z.string().optional(),
    descPerformed: z.string().optional(),
    date: z.union([z.string(), z.null()]).optional(),
    tech: z.string().optional(),
    paid: z.boolean().optional(),
    completed: z.boolean().optional(),
    certify: z.boolean().optional(),
    addressRef: objectIdOrNull,
    equipmentRef: objectIdOrNull,
    parts: z.array(ticketPartSchema).optional(),
  })
  .merge(ticketSnapshotSchema)
  .merge(ticketMoneySchema)
  .merge(ticketSignatureSchema);

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;
