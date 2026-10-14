import { z } from "zod";

export const quoCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1, "API key is required").optional(),
  label: z.string().trim().max(120).optional(),
  isActive: z.boolean().optional(),
});

export type QuoCredentialsInput = z.infer<typeof quoCredentialsSchema>;
