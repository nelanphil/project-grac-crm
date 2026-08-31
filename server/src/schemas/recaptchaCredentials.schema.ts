import { z } from "zod";

export const saveRecaptchaCredentialsSchema = z.object({
  siteKey: z.string().trim().min(1, "Site key is required").max(200).optional(),
  secretKey: z.string().trim().min(1, "Secret key is required").optional(),
  version: z.enum(["v2", "v3"]).optional(),
  minScore: z.coerce.number().min(0).max(1).optional(),
  isActive: z.boolean().optional(),
});

export type SaveRecaptchaCredentialsInput = z.infer<
  typeof saveRecaptchaCredentialsSchema
>;
