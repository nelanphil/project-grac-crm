import { z } from "zod";
import { NOTE_TEMPLATE_SCOPES } from "../models/mongo/NoteTemplate";

export const createNoteTemplateSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  body: z.string().trim().min(1, "Body is required").max(5000),
  scope: z.enum(NOTE_TEMPLATE_SCOPES).optional(),
});

export const updateNoteTemplateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(5000).optional(),
});

export type CreateNoteTemplateInput = z.infer<typeof createNoteTemplateSchema>;
export type UpdateNoteTemplateInput = z.infer<typeof updateNoteTemplateSchema>;
