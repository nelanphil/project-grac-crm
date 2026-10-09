import { z } from "zod";

const noteContentSchema = z
  .string()
  .trim()
  .min(1, "Note content is required")
  .max(5000, "Note must be 5000 characters or fewer");

const mentionUserIdsSchema = z.array(z.string()).max(20).optional();

export const createWorkOrderNoteSchema = z.object({
  content: noteContentSchema,
  visibleToCustomer: z.boolean().optional().default(true),
  templateId: z.string().optional(),
  isReminder: z.boolean().optional().default(false),
  mentionUserIds: mentionUserIdsSchema,
});

export const updateWorkOrderNoteSchema = z.object({
  content: noteContentSchema.optional(),
  visibleToCustomer: z.boolean().optional(),
  isReminder: z.boolean().optional(),
  mentionUserIds: mentionUserIdsSchema,
});

export type CreateWorkOrderNoteInput = z.infer<typeof createWorkOrderNoteSchema>;
export type UpdateWorkOrderNoteInput = z.infer<typeof updateWorkOrderNoteSchema>;
