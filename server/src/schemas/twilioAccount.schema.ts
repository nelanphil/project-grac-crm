import { z } from "zod";

const accountSidSchema = z
  .string()
  .trim()
  .regex(/^AC[0-9a-fA-F]{32}$/, "Account SID must be AC followed by 32 hex characters");

export const createTwilioAccountSchema = z.object({
  accountSid: accountSidSchema,
  friendlyName: z.string().trim().min(1, "Account name is required").max(120),
  authToken: z.string().trim().min(1, "Auth token is required"),
  testAuthToken: z.string().trim().optional(),
  phoneNumbers: z.array(z.string().trim().min(1)).optional().default([]),
  isActive: z.boolean().optional().default(true),
});

export const updateTwilioAccountSchema = z.object({
  accountSid: accountSidSchema.optional(),
  friendlyName: z.string().trim().min(1).max(120).optional(),
  authToken: z.string().trim().optional(),
  testAuthToken: z.string().trim().optional(),
  phoneNumbers: z.array(z.string().trim().min(1)).optional(),
  isActive: z.boolean().optional(),
});

export type CreateTwilioAccountInput = z.infer<typeof createTwilioAccountSchema>;
export type UpdateTwilioAccountInput = z.infer<typeof updateTwilioAccountSchema>;
