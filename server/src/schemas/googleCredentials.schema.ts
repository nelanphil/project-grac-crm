import { z } from "zod";

export const saveGoogleCredentialsSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  apiKey: z.string().trim().min(1, "API key is required").optional(),
  projectId: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
});

export type SaveGoogleCredentialsInput = z.infer<
  typeof saveGoogleCredentialsSchema
>;
