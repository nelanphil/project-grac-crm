import { z } from "zod";

const recipientEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Invalid email address")
  .max(255);

export const saveContactFormSettingsSchema = z.object({
  emails: z
    .array(recipientEmailSchema)
    .max(20, "A maximum of 20 recipient emails is allowed")
    .transform((emails) => [...new Set(emails)]),
});

export const submitContactFormSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  email: z.string().trim().email("Please enter a valid email").max(255),
  phone: z.string().trim().max(40).optional().default(""),
  message: z.string().trim().min(1, "Message is required").max(5000),
  /** Honeypot — must be empty. Checked in the controller so bots get a silent 200. */
  website: z.string().optional().default(""),
  recaptchaToken: z.string().optional().default(""),
});

export type SaveContactFormSettingsInput = z.infer<
  typeof saveContactFormSettingsSchema
>;
export type SubmitContactFormInput = z.infer<typeof submitContactFormSchema>;
