import { z } from "zod";

export const MISSED_CALL_TEXT_MAX = 1600;

export const saveTwilioResponseSettingsSchema = z.object({
  missedCallText: z
    .string()
    .trim()
    .min(1, "Message is required")
    .max(MISSED_CALL_TEXT_MAX, "Message must be 1600 characters or fewer"),
});

export type SaveTwilioResponseSettingsInput = z.infer<
  typeof saveTwilioResponseSettingsSchema
>;
