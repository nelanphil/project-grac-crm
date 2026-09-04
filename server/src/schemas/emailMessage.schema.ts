import { z } from "zod";
import {
  EMAIL_BODY_MAX,
  EMAIL_SUBJECT_MAX,
  emailChromeSchema,
} from "./messageTemplate.schema";

export const emailPaymentLinkAvailabilitySchema = z.object({
  customerIds: z.array(z.string().trim().min(1)).min(1).max(200),
});

export const emailMessagePreviewSchema = z
  .object({
    subject: z.string().max(EMAIL_SUBJECT_MAX).optional().default(""),
    body: z.string().max(EMAIL_BODY_MAX).optional().default(""),
    emailChrome: emailChromeSchema.optional(),
    contactId: z.string().trim().min(1).optional(),
    renewalYear: z.number().int().min(1970).max(2100).optional(),
    renewalMonth: z.number().int().min(1).max(12).optional(),
    includePaymentLink: z.boolean().optional(),
  })
  .refine(
    (data) =>
      (data.renewalYear === undefined && data.renewalMonth === undefined) ||
      (data.renewalYear !== undefined && data.renewalMonth !== undefined),
    {
      message: "Both renewalYear and renewalMonth are required together",
      path: ["renewalMonth"],
    },
  );

export const emailMessageSendSchema = z
  .object({
    contactIds: z.array(z.string().trim().min(1)).min(1).max(200),
    subject: z.string().max(EMAIL_SUBJECT_MAX).optional(),
    body: z.string().max(EMAIL_BODY_MAX).optional(),
    emailChrome: emailChromeSchema.optional(),
    templateId: z.string().trim().min(1).optional(),
    emailAccountId: z.string().trim().min(1),
    fromName: z.string().trim().max(120).optional(),
    replyTo: z
      .union([z.string().trim().email().max(255), z.literal("")])
      .optional()
      .transform((value) => (value ? value : undefined)),
    emailsPerSecond: z.number().int().min(1).max(10).optional().default(2),
    renewalYear: z.number().int().min(1970).max(2100).optional(),
    renewalMonth: z.number().int().min(1).max(12).optional(),
    includePaymentLink: z.boolean().optional(),
  })
  .refine(
    (data) =>
      Boolean(data.body?.trim()) ||
      Boolean(data.subject?.trim()) ||
      Boolean(data.templateId),
    {
      message: "Either subject/body or templateId is required",
      path: ["body"],
    },
  )
  .refine(
    (data) =>
      (data.renewalYear === undefined && data.renewalMonth === undefined) ||
      (data.renewalYear !== undefined && data.renewalMonth !== undefined),
    {
      message: "Both renewalYear and renewalMonth are required together",
      path: ["renewalMonth"],
    },
  );
