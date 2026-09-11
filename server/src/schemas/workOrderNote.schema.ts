import { z } from "zod";

const noteContentSchema = z
  .string()
  .trim()
  .min(1, "Note content is required")
  .max(5000, "Note must be 5000 characters or fewer");

export const createWorkOrderNoteSchema = z.object({
  content: noteContentSchema,
  visibleToCustomer: z.boolean().optional().default(true),
  templateId: z.string().optional(),
});

export const updateWorkOrderNoteSchema = z.object({
  content: noteContentSchema.optional(),
  visibleToCustomer: z.boolean().optional(),
});

export type CreateWorkOrderNoteInput = z.infer<typeof createWorkOrderNoteSchema>;
export type UpdateWorkOrderNoteInput = z.infer<typeof updateWorkOrderNoteSchema>;
