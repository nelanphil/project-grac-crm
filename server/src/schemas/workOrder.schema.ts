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
const requiredDate = z
  .string({ message: "Date is required" })
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}/, "Date is required");

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
    date: requiredDate,
    startTime: optionalTime,
    endTime: optionalTime,
    tech: z.string().optional(),
    assignedUserRef: objectIdOrNull,
    assignedUserRefs: z.array(z.string().trim()).max(8).optional(),
    workOrderTypeRef: objectIdOrNull,
    scheduledStart: z.union([z.string(), z.null()]).optional(),
    estimatedMinutes: z.number().int().min(15).max(24 * 60).optional(),
    paid: z.boolean().optional(),
    completed: z.boolean().optional(),
    certify: z.boolean().optional(),
    parts: z.array(ticketPartSchema).optional(),
    notes: z
      .array(
        z.object({
          content: z
            .string()
            .trim()
            .min(1, "Note content is required")
            .max(5000, "Note must be 5000 characters or fewer"),
          visibleToCustomer: z.boolean().optional().default(false),
          templateId: z.string().optional(),
          isReminder: z.boolean().optional().default(false),
          mentionUserIds: z.array(z.string()).max(20).optional(),
        }),
      )
      .optional(),
  })
  .merge(ticketSnapshotSchema)
  .merge(ticketMoneySchema)
  .merge(ticketSignatureSchema)
  .merge(ticketContractSchema)
  .superRefine(refineTimeWindow);

export const updateWorkOrderSchema = z
  .object({
    assignedUserRef: objectIdOrNull,
    assignedUserRefs: z.array(z.string().trim()).max(8).optional(),
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

const completionContactSchema = {
  contactId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9]{24}$/, "Choose a contact"),
  phoneOverride: z.string().trim().max(40).optional(),
  emailOverride: z.string().trim().max(200).optional(),
};

export const completeWorkOrderSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("pay_now") }),
  z.object({ mode: z.literal("send"), ...completionContactSchema }),
  z.object({ mode: z.literal("resend"), ...completionContactSchema }),
  z.object({
    mode: z.literal("paid_offline"),
    method: z.enum(["check", "cash"]),
    checkNumber: z.string().trim().max(40).optional(),
    proofUrl: z
      .string()
      .trim()
      .max(2000)
      .startsWith("https://", "Proof URL must start with https://")
      .optional(),
  }),
]);

export const sendWorkOrderReceiptSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("email"),
    email: z.string().trim().max(200),
    saveToContact: z.boolean().optional(),
  }),
  z.object({
    channel: z.literal("sms"),
    phone: z.string().trim().max(40),
  }),
]);

export type CompleteWorkOrderInput = z.infer<typeof completeWorkOrderSchema>;
export type SendWorkOrderReceiptInput = z.infer<typeof sendWorkOrderReceiptSchema>;
