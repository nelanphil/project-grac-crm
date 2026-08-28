import { z } from "zod";
import { TWILIO_SAY_VOICE_VALUES } from "../utils/twilioVoices";

const accountSidSchema = z
  .string()
  .trim()
  .regex(
    /^AC[0-9a-fA-F]{32}$/,
    "Account SID must be AC followed by 32 hex characters",
  );

const sayVoiceSchema = z.enum(TWILIO_SAY_VOICE_VALUES);

export const createTwilioAccountSchema = z.object({
  accountSid: accountSidSchema,
  friendlyName: z.string().trim().min(1, "Account name is required").max(120),
  authToken: z.string().trim().min(1, "Auth token is required"),
  testAccountSid: z.string().trim().optional(),
  testAuthToken: z.string().trim().optional(),
  phoneNumbers: z.array(z.string().trim().min(1)).optional().default([]),
  isActive: z.boolean().optional().default(true),
  sayVoice: sayVoiceSchema.optional(),
});

export const updateTwilioAccountSchema = z.object({
  accountSid: accountSidSchema.optional(),
  friendlyName: z.string().trim().min(1).max(120).optional(),
  // Live auth token can be replaced but never explicitly cleared (it's required).
  authToken: z.string().trim().min(1).optional(),
  // string = set new value, null = explicitly clear, undefined = leave unchanged
  testAccountSid: z.string().trim().nullable().optional(),
  testAuthToken: z.string().trim().min(1).nullable().optional(),
  phoneNumbers: z.array(z.string().trim().min(1)).optional(),
  isActive: z.boolean().optional(),
  sayVoice: sayVoiceSchema.optional(),
});

export type CreateTwilioAccountInput = z.infer<
  typeof createTwilioAccountSchema
>;
export type UpdateTwilioAccountInput = z.infer<
  typeof updateTwilioAccountSchema
>;
