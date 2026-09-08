import { z } from "zod";

const objectIdString = z
  .string()
  .trim()
  .regex(/^[a-fA-F0-9]{24}$/, "Invalid user id");

export const createWorkOrderTypeSchema = z.object({
  label: z.string().trim().min(1).max(120),
  qualifiedUserRefs: z.array(objectIdString).optional().default([]),
});

export const updateWorkOrderTypeSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  qualifiedUserRefs: z.array(objectIdString).optional(),
});

export type CreateWorkOrderTypeInput = z.infer<typeof createWorkOrderTypeSchema>;
export type UpdateWorkOrderTypeInput = z.infer<typeof updateWorkOrderTypeSchema>;
