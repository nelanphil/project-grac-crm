import { z } from "zod";

const noteContentSchema = z
  .string()
  .trim()
  .min(1, "Note content is required")
  .max(5000, "Note must be 5000 characters or fewer");

export const createCustomerNoteSchema = z.object({
  content: noteContentSchema,
});

export const updateCustomerNoteSchema = z.object({
  content: noteContentSchema,
});

export const markCustomerNotesViewedSchema = z.object({
  noteIds: z.array(z.string().trim().min(1)).min(1).max(500),
});

export type CreateCustomerNoteInput = z.infer<typeof createCustomerNoteSchema>;
export type UpdateCustomerNoteInput = z.infer<typeof updateCustomerNoteSchema>;
