import { z } from "zod";
import {
  ticketContractSchema,
  ticketMoneySchema,
  ticketPartSchema,
  ticketSignatureSchema,
  ticketSnapshotSchema,
} from "./serviceTicket.schema";

const objectIdOrNull = z.union([z.string().trim(), z.null()]).optional();

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

const optionalTime = z
  .union([
    z.string().regex(hhmm, "Use a valid time"),
    z.literal(""),
    z.null(),
  ])
  .optional();

function refineTimeWindow(
  data: { startTime?: string | null; endTime?: string | null },
  ctx: z.RefinementCtx,
) {
  const start = typeof data.startTime === "string" ? data.startTime : "";
  const end = typeof data.endTime === "string" ? data.endTime : "";
  if (start && end && end <= start) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End time must be after start time",
      path: ["endTime"],
    });
  }
}

export const createWorkOrderSchema = z
  .object({
    customerId: z.coerce.number().int().positive(),
    addressRef: objectIdOrNull,
    equipmentRef: objectIdOrNull,
    estimateRef: objectIdOrNull,
    descPerform: z.string().optional(),
    descPerformed: z.string().optional(),
    date: z.union([z.string(), z.null()]).optional(),
    startTime: optionalTime,
    endTime: optionalTime,
    tech: z.string().optional(),
    assignedUserRef: objectIdOrNull,
    workOrderTypeRef: objectIdOrNull,
    scheduledStart: z.union([z.string(), z.null()]).optional(),
    estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
    paid: z.boolean().optional(),
    completed: z.boolean().optional(),
    certify: z.boolean().optional(),
    parts: z.array(ticketPartSchema).optional(),
  })
  .merge(ticketSnapshotSchema)
  .merge(ticketMoneySchema)
  .merge(ticketSignatureSchema)
  .merge(ticketContractSchema)
  .superRefine(refineTimeWindow);

export const updateWorkOrderSchema = z
  .object({
    assignedUserRef: objectIdOrNull,
    workOrderTypeRef: objectIdOrNull,
    scheduledStart: z.union([z.string(), z.null()]).optional(),
    estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
    descPerform: z.string().optional(),
    descPerformed: z.string().optional(),
    date: z.union([z.string(), z.null()]).optional(),
    startTime: optionalTime,
    endTime: optionalTime,
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
  .merge(ticketSignatureSchema)
  .merge(ticketContractSchema)
  .superRefine(refineTimeWindow);

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;
